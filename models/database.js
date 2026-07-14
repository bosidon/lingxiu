const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, '..', 'data', 'xianbao.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      icon TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      subtitle TEXT,
      author TEXT,
      category_id INTEGER,
      description TEXT,
      cover_image TEXT,
      total_chars INTEGER DEFAULT 0,
      is_free INTEGER DEFAULT 1,
      price_cents INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      status TEXT DEFAULT 'published',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      content_html TEXT,
      sort_order INTEGER DEFAULT 0,
      word_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audio_albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      cover_image TEXT,
      category_id INTEGER,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS audio_tracks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      album_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      duration INTEGER,
      audio_url TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (album_id) REFERENCES audio_albums(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      nickname TEXT,
      avatar TEXT,
      role TEXT DEFAULT 'user',
      is_vip INTEGER DEFAULT 0,
      vip_expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      plan_type TEXT NOT NULL DEFAULT 'monthly',
      status TEXT DEFAULT 'active',
      amount_cents INTEGER DEFAULT 0,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS reading_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      book_id INTEGER NOT NULL,
      chapter_id INTEGER,
      progress REAL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (book_id) REFERENCES books(id),
      UNIQUE(user_id, book_id)
    );

    CREATE TABLE IF NOT EXISTS chapter_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_id INTEGER NOT NULL UNIQUE,
      summary TEXT,
      key_points TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS book_qa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      chapter_id INTEGER,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book_id) REFERENCES books(id)
    );

    CREATE TABLE IF NOT EXISTS glossary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER,
      term TEXT NOT NULL UNIQUE,
      explanation TEXT NOT NULL,
      category TEXT DEFAULT '综合',
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS search_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_type TEXT NOT NULL,
      content_id INTEGER NOT NULL,
      title TEXT,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS site_config (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS book_downloads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      file_size TEXT,
      file_url TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    -- AI助读主题分类
    CREATE TABLE IF NOT EXISTS ai_deep_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      icon TEXT DEFAULT '📚',
      theme_count INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    -- AI助读主题详情
    CREATE TABLE IF NOT EXISTS ai_deep_themes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      overview TEXT,
      key_concepts TEXT,
      core_content TEXT,
      related_passages TEXT,
      practical_application TEXT,
      cross_references TEXT,
      content_html TEXT,
      status TEXT DEFAULT 'draft',
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES ai_deep_categories(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS page_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT,
      referer TEXT,
      user_id INTEGER,
      viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Insert default config
  const insertConfig = db.prepare(`INSERT OR IGNORE INTO site_config (key, value) VALUES (?, ?)`);
  insertConfig.run('site_name', '仙宝心灵成长');
  insertConfig.run('site_tagline', '探索内在世界，点亮心灵之光');
  insertConfig.run('site_domain', 'xianbao.online');
  insertConfig.run('welcome_message', '欢迎来到仙宝心灵成长 — 你的灵性探索空间');
  insertConfig.run('vip_monthly_price', '2990'); // cents
  insertConfig.run('vip_annual_price', '29900');
}

// Seed default data
function seedData() {
  const db = getDb();
  
  const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get();
  if (catCount.c > 0) return;

  console.log('🌱 Seeding initial data...');

  const categories = [
    { name: '赛斯资料', slug: 'seth', description: '赛斯书系列，珍·罗伯兹通灵传导的宇宙观体系', icon: '🌟', sort_order: 1 },
    { name: '欧林系列', slug: 'orin', description: '欧林通过珊娜雅·罗曼通灵传导的灵性教导', icon: '🌿', sort_order: 2 },
    { name: '与神对话', slug: 'cwg', description: '尼尔·唐纳德·沃尔什的与神对话系列', icon: '💬', sort_order: 3 },
    { name: '光之手系列', slug: 'hands-of-light', description: '芭芭拉·布蓝能的能量疗愈体系', icon: '✨', sort_order: 4 },
    { name: '经典合集', slug: 'classics', description: '其他灵性经典著作', icon: '📖', sort_order: 5 },
    { name: '冥想音频', slug: 'meditation', description: '灵性冥想引导音频', icon: '🎵', sort_order: 6 },
  ];

  const insertCat = db.prepare(`INSERT INTO categories (name, slug, description, icon, sort_order) VALUES (?, ?, ?, ?, ?)`);
  for (const c of categories) {
    insertCat.run(c.name, c.slug, c.description, c.icon, c.sort_order);
  }

  // Create admin user: admin / admin123
  const adminPw = bcrypt.hashSync('admin123', 10);
  db.prepare(`INSERT INTO users (email, username, password, nickname, role, is_vip, vip_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('admin@xianbao.online', 'admin', adminPw, '管理员', 'admin', 1, '2099-12-31');

  console.log('✅ Seed complete: admin/admin123');
}

function initialize() {
  getDb();
  seedData();
}

module.exports = { getDb, initialize };
