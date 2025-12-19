const express = require('express');
const axios = require('axios');
const db = require('../db');

const router = express.Router();

const TIKTOK_VIDEO_QUERY_URL = 'https://open.tiktokapis.com/v2/video/query/';

// Simple admin auth middleware
const adminAuth = (req, res, next) => {
  const password = req.headers['x-admin-password'];
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Extract video ID from TikTok URL
function extractVideoId(url) {
  // Handles URLs like:
  // https://www.tiktok.com/@username/video/1234567890123456789
  // https://vm.tiktok.com/ZMxxxxxx/
  // https://www.tiktok.com/t/ZTxxxxxx/
  
  const patterns = [
    /video\/(\d+)/,
    /\/v\/(\d+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  // For short URLs, we'd need to follow redirect (simplified for PoC)
  return null;
}

// Submit a video (user)
router.post('/', async (req, res) => {
  try {
    const { sessionId, videoUrl, walletAddress, campaignId } = req.body;

    // Validate inputs
    if (!sessionId || !videoUrl || !walletAddress) {
      return res.status(400).json({ error: 'Session ID, video URL, and wallet address required' });
    }

    // Validate wallet address format (Starknet)
    if (!walletAddress.match(/^0x[a-fA-F0-9]{1,64}$/)) {
      return res.status(400).json({ error: 'Invalid Starknet wallet address' });
    }

    // Get session
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
    if (!session) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    // Get campaign (specific or latest active)
    let campaign;
    if (campaignId) {
      campaign = db.prepare('SELECT * FROM campaigns WHERE id = ? AND is_active = 1').get(campaignId);
      if (!campaign) {
        return res.status(400).json({ error: 'Campaign not found or not active' });
      }
    } else {
      campaign = db.prepare('SELECT * FROM campaigns WHERE is_active = 1 ORDER BY id DESC LIMIT 1').get();
      if (!campaign) {
        return res.status(400).json({ error: 'No active campaign' });
      }
    }

    // Extract video ID
    const videoId = extractVideoId(videoUrl);
    if (!videoId) {
      return res.status(400).json({ error: 'Could not extract video ID from URL. Please use a direct TikTok video URL.' });
    }

    // Check if video already submitted
    const existing = db.prepare('SELECT * FROM submissions WHERE video_id = ?').get(videoId);
    if (existing) {
      return res.status(400).json({ error: 'This video has already been submitted' });
    }

    // Query TikTok API for video details
    let videoData = null;
    try {
      const response = await axios.post(
        `${TIKTOK_VIDEO_QUERY_URL}?fields=id,title,video_description,like_count,comment_count,share_count,view_count`,
        {
          filters: {
            video_ids: [videoId]
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const videos = response.data.data?.videos || [];
      if (videos.length === 0) {
        return res.status(400).json({ 
          error: 'Video not found or does not belong to your account. Make sure you are logged in with the correct TikTok account.' 
        });
      }
      videoData = videos[0];
    } catch (apiError) {
      console.error('TikTok API error:', apiError.response?.data || apiError.message);
      // For demo purposes, allow submission even if API fails (with mock data)
      videoData = {
        id: videoId,
        view_count: 0,
        like_count: 0,
        comment_count: 0,
        share_count: 0
      };
    }

    // Check eligibility
    const isEligible = 
      (videoData.view_count || 0) >= campaign.min_views &&
      (videoData.like_count || 0) >= campaign.min_likes &&
      (videoData.comment_count || 0) >= campaign.min_comments &&
      (videoData.share_count || 0) >= campaign.min_shares;

    const status = isEligible ? 'eligible' : 'rejected';

    // Save submission
    const result = db.prepare(`
      INSERT INTO submissions (campaign_id, video_id, video_url, tiktok_open_id, tiktok_username, wallet_address, view_count, like_count, comment_count, share_count, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      campaign.id,
      videoId,
      videoUrl,
      session.tiktok_open_id,
      session.tiktok_username,
      walletAddress,
      videoData.view_count || 0,
      videoData.like_count || 0,
      videoData.comment_count || 0,
      videoData.share_count || 0,
      status
    );

    const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(result.lastInsertRowid);

    res.json({
      submission,
      eligible: isEligible,
      message: isEligible 
        ? `Congratulations! Your video is eligible for ${campaign.reward_amount} STRK.`
        : `Your video does not meet the criteria. Required: ${campaign.min_views} views, ${campaign.min_likes} likes.`
    });

  } catch (error) {
    console.error('Submission error:', error);
    res.status(500).json({ error: 'Submission failed' });
  }
});

// Get all submissions (admin)
router.get('/', adminAuth, (req, res) => {
  const { campaign_id, status } = req.query;
  
  let query = 'SELECT s.*, c.name as campaign_name, c.reward_amount FROM submissions s JOIN campaigns c ON s.campaign_id = c.id WHERE 1=1';
  const params = [];

  if (campaign_id) {
    query += ' AND s.campaign_id = ?';
    params.push(campaign_id);
  }

  if (status) {
    query += ' AND s.status = ?';
    params.push(status);
  }

  query += ' ORDER BY s.created_at DESC';

  const submissions = db.prepare(query).all(...params);
  res.json(submissions);
});

// Get submission stats (admin)
router.get('/stats', adminAuth, (req, res) => {
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'eligible' THEN 1 ELSE 0 END) as eligible,
      SUM(CASE WHEN status = 'winner' THEN 1 ELSE 0 END) as winners,
      SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
    FROM submissions
  `).get();

  res.json(stats);
});

// Update submission status (admin)
router.patch('/:id', adminAuth, (req, res) => {
  const { status } = req.body;
  
  if (!['pending', 'eligible', 'winner', 'paid', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  db.prepare('UPDATE submissions SET status = ? WHERE id = ?').run(status, req.params.id);
  
  const submission = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
  res.json(submission);
});

// Batch update status (admin)
router.post('/batch-status', adminAuth, (req, res) => {
  const { ids, status } = req.body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'IDs array required' });
  }

  if (!['pending', 'eligible', 'winner', 'paid', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }

  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE submissions SET status = ? WHERE id IN (${placeholders})`).run(status, ...ids);

  res.json({ success: true, updated: ids.length });
});

module.exports = router;
