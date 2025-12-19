const express = require('express');
const db = require('../db');

const router = express.Router();

// Simple admin auth middleware
const adminAuth = (req, res, next) => {
  const password = req.headers['x-admin-password'];
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

// Get active campaign (public)
router.get('/active', (req, res) => {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE is_active = 1 ORDER BY id DESC LIMIT 1').get();
  
  if (!campaign) {
    return res.status(404).json({ error: 'No active campaign' });
  }

  res.json(campaign);
});

// Get all campaigns (admin)
router.get('/', adminAuth, (req, res) => {
  const campaigns = db.prepare('SELECT * FROM campaigns ORDER BY id DESC').all();
  res.json(campaigns);
});

// Create campaign (admin)
router.post('/', adminAuth, (req, res) => {
  const { name, min_views, min_likes, min_comments, min_shares, reward_amount, max_winners } = req.body;

  if (!name || !reward_amount) {
    return res.status(400).json({ error: 'Name and reward amount required' });
  }

  const result = db.prepare(`
    INSERT INTO campaigns (name, min_views, min_likes, min_comments, min_shares, reward_amount, max_winners)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    min_views || 0,
    min_likes || 0,
    min_comments || 0,
    min_shares || 0,
    reward_amount,
    max_winners || 100
  );

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(result.lastInsertRowid);
  res.json(campaign);
});

// Update campaign (admin)
router.put('/:id', adminAuth, (req, res) => {
  const { name, min_views, min_likes, min_comments, min_shares, reward_amount, max_winners, is_active } = req.body;

  db.prepare(`
    UPDATE campaigns 
    SET name = COALESCE(?, name),
        min_views = COALESCE(?, min_views),
        min_likes = COALESCE(?, min_likes),
        min_comments = COALESCE(?, min_comments),
        min_shares = COALESCE(?, min_shares),
        reward_amount = COALESCE(?, reward_amount),
        max_winners = COALESCE(?, max_winners),
        is_active = COALESCE(?, is_active)
    WHERE id = ?
  `).run(name, min_views, min_likes, min_comments, min_shares, reward_amount, max_winners, is_active, req.params.id);

  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(req.params.id);
  res.json(campaign);
});

// Delete campaign (admin)
router.delete('/:id', adminAuth, (req, res) => {
  const campaignId = req.params.id;
  
  // Check if there are submissions linked to this campaign
  const submissions = db.prepare('SELECT COUNT(*) as count FROM submissions WHERE campaign_id = ?').get(campaignId);
  
  if (submissions.count > 0) {
    // Delete associated submissions first
    db.prepare('DELETE FROM submissions WHERE campaign_id = ?').run(campaignId);
  }
  
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(campaignId);
  res.json({ success: true });
});

module.exports = router;
