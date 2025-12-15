const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_USER_INFO_URL = 'https://open.tiktokapis.com/v2/user/info/';

// Generate TikTok OAuth URL
router.get('/tiktok/url', (req, res) => {
  const state = uuidv4();
  const scope = 'user.info.basic,video.list';
  
  const params = new URLSearchParams({
    client_key: process.env.TIKTOK_CLIENT_KEY,
    response_type: 'code',
    scope: scope,
    redirect_uri: process.env.TIKTOK_REDIRECT_URI,
    state: state
  });

  const authUrl = `${TIKTOK_AUTH_URL}?${params.toString()}`;
  
  res.json({ url: authUrl, state });
});

// TikTok OAuth callback
router.post('/tiktok/callback', async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Authorization code required' });
    }

    // Exchange code for access token
    const tokenResponse = await axios.post(TIKTOK_TOKEN_URL, {
      client_key: process.env.TIKTOK_CLIENT_KEY,
      client_secret: process.env.TIKTOK_CLIENT_SECRET,
      code: code,
      grant_type: 'authorization_code',
      redirect_uri: process.env.TIKTOK_REDIRECT_URI
    }, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const { access_token, open_id } = tokenResponse.data;

    if (!access_token) {
      return res.status(400).json({ error: 'Failed to get access token', details: tokenResponse.data });
    }

    // Get user info
    const userResponse = await axios.get(TIKTOK_USER_INFO_URL, {
      params: { fields: 'open_id,display_name,avatar_url' },
      headers: { 'Authorization': `Bearer ${access_token}` }
    });

    const userData = userResponse.data.data?.user || {};
    const username = userData.display_name || 'TikTok User';

    // Create session
    const sessionId = uuidv4();
    db.prepare(`
      INSERT INTO sessions (id, tiktok_open_id, tiktok_username, access_token)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, open_id, username, access_token);

    res.json({
      sessionId,
      user: {
        openId: open_id,
        username: username,
        avatar: userData.avatar_url
      }
    });

  } catch (error) {
    console.error('TikTok callback error:', error.response?.data || error.message);
    res.status(500).json({ error: 'Authentication failed', details: error.response?.data });
  }
});

// Verify session
router.get('/session/:sessionId', (req, res) => {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(req.params.sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json({
    user: {
      openId: session.tiktok_open_id,
      username: session.tiktok_username
    }
  });
});

// Logout
router.delete('/session/:sessionId', (req, res) => {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.sessionId);
  res.json({ success: true });
});

module.exports = router;
