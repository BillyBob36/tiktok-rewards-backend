const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '../data/rewards.db'));

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    min_views INTEGER DEFAULT 0,
    min_likes INTEGER DEFAULT 0,
    min_comments INTEGER DEFAULT 0,
    min_shares INTEGER DEFAULT 0,
    reward_amount TEXT NOT NULL,
    max_winners INTEGER DEFAULT 100,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id INTEGER NOT NULL,
    video_id TEXT NOT NULL UNIQUE,
    video_url TEXT NOT NULL,
    tiktok_open_id TEXT NOT NULL,
    tiktok_username TEXT,
    wallet_address TEXT NOT NULL,
    view_count INTEGER DEFAULT 0,
    like_count INTEGER DEFAULT 0,
    comment_count INTEGER DEFAULT 0,
    share_count INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    tx_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    paid_at DATETIME,
    FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    tiktok_open_id TEXT,
    tiktok_username TEXT,
    access_token TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Insert default campaign if none exists
const campaignCount = db.prepare('SELECT COUNT(*) as count FROM campaigns').get();
if (campaignCount.count === 0) {
  db.prepare(`
    INSERT INTO campaigns (name, min_views, min_likes, reward_amount, max_winners)
    VALUES (?, ?, ?, ?, ?)
  `).run('Campaign TikTok #1', 1000, 50, '10', 50);
}

module.exports = db;
