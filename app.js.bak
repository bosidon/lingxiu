const express = require('express');
const { verifyToken, extractToken } = require("/var/www/auth-verify");
const path = require('path');
const { marked } = require('marked');
const { initialize, getDb } = require('./models/database');
const { importContent } = require('./scripts/import_content');
const https = require('https');

initialize();

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(require('cookie-parser')());
app.use(express.urlencoded({ extended: true }));


// 仅查询用量（不递增）
async function checkReadingUsage(req) {
  try {
    const token = extractToken(req);
    if (!token) return { ok: true, loggedIn: false };
    const response = await fetch('http://localhost:3050/api/usage/check?service=reading', {
      headers: { 'Cookie': `xianbao_token=${token}` }
    });
    const data = await response.json();
    if (data.success && data.data && !data.data.allowed) {
      return { ok: false, reason: 'quota_exceeded' };
    }
    return { ok: true, loggedIn: true };
  } catch (err) {
    console.error('Usage check error:', err.message);
    return { ok: true, loggedIn: false };
  }
}

// 递增用量（消耗一次精读/助读机会）
async function incrementReadingUsage(req, count = 1) {
  try {
    const token = extractToken(req);
    if (!token) return { ok: true, loggedIn: false };
    const response = await fetch('http://localhost:3050/api/usage/increment', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `xianbao_token=${token}`
      },
      body: JSON.stringify({ service: 'reading', count })
    });
    if (response.status === 403) {
      return { ok: false, reason: 'quota_exceeded' };
    }
    return { ok: true, loggedIn: true };
  } catch (err) {
    console.error('Usage increment error:', err.message);
    return { ok: true, loggedIn: false };
  }
}

// ===== HOME =====
app.get('/', (req, res) => {
  const db = getDb();
  const stats = {
    books: db.prepare("SELECT COUNT(*) as c FROM books WHERE status='published'").get().c,
    chars: db.prepare("SELECT COALESCE(SUM(total_chars),0) as c FROM books WHERE status='published'").get().c,
  };
  const cats = db.prepare("SELECT c.*, COUNT(b.id) as cnt FROM categories c LEFT JOIN books b ON b.category_id=c.id AND b.status='published' GROUP BY c.id ORDER BY c.sort_order").all();
  const catBooks = cats.filter(c => {
    const books = db.prepare("SELECT id,title,total_chars,is_free,description FROM books WHERE status='published' AND category_id=? ORDER BY sort_order").all(c.id);
    c.books = books;
    return books.length > 0;
  });
  res.render('index', { stats, cats: catBooks });
});

// ===== BOOKS =====
app.get('/books', (req, res) => {
  const db = getDb();
  const cats = db.prepare("SELECT c.* FROM categories c WHERE EXISTS (SELECT 1 FROM books b WHERE b.category_id=c.id AND b.status='published') ORDER BY c.sort_order").all();
  const cat = req.query.cat || '';
  const search = req.query.q || '';
  let books;
  if (search) {
    books = db.prepare("SELECT b.*,c.name as cname,c.slug as cslug FROM books b JOIN categories c ON c.id=b.category_id WHERE b.status='published' AND b.title LIKE ? ORDER BY b.sort_order").all(`%${search}%`);
  } else if (cat) {
    const c = db.prepare("SELECT * FROM categories WHERE slug=?").get(cat);
    books = c ? db.prepare("SELECT b.*,c.name as cname,c.slug as cslug FROM books b JOIN categories c ON c.id=b.category_id WHERE b.status='published' AND b.category_id=? ORDER BY b.sort_order").all(c.id) : [];
  } else {
    books = db.prepare("SELECT b.*,c.name as cname,c.slug as cslug FROM books b JOIN categories c ON c.id=b.category_id WHERE b.status='published' ORDER BY b.sort_order").all();
  }
  res.render('books', { books, cats, currentCat: cat, search });
});

// ===== BOOK DETAIL =====
app.get('/books/:id', (req, res) => {
  const db = getDb();
  const book = db.prepare("SELECT b.*,c.name as cname,c.slug as cslug FROM books b JOIN categories c ON c.id=b.category_id WHERE b.id=? AND b.status='published'").get(req.params.id);
  if (!book) return res.redirect('/books');
  const chapters = db.prepare("SELECT * FROM chapters WHERE book_id=? ORDER BY sort_order").all(book.id);
  const related = db.prepare("SELECT id,title,total_chars,is_free FROM books WHERE category_id=? AND id!=? AND status='published' LIMIT 4").all(book.category_id, book.id);
  const summaryIds = db.prepare("SELECT chapter_id FROM chapter_summaries WHERE chapter_id IN (SELECT id FROM chapters WHERE book_id=?)").all(req.params.id).map(r => r.chapter_id);
  const summaryMap = {};
  summaryIds.forEach(id => { summaryMap[id] = true; });
  const downloads = db.prepare("SELECT * FROM book_downloads WHERE book_id=?").all(req.params.id);
  const hasQA = (() => { try { return db.prepare("SELECT COUNT(*) as c FROM book_qa WHERE book_id=?").get(req.params.id).c > 0; } catch(e) { return false; } })();
  const hasGlossary = (() => { try { return db.prepare("SELECT COUNT(*) as c FROM glossary WHERE book_id=?").get(req.params.id).c > 0; } catch(e) { return false; } })();
  
  // 解析分类数据和知识汇编
  var bookCls = null;
  if (book.classification) {
    try { bookCls = JSON.parse(book.classification); } catch(e) { bookCls = null; }
  }
  var bookKnowledge = null;
  if (book.knowledge) {
    try { bookKnowledge = JSON.parse(book.knowledge); } catch(e) { bookKnowledge = null; }
  }
  
  // AI助读状态
  var hasAIDeepV2 = (() => {
    try { return db.prepare("SELECT COUNT(*) as c FROM ai_deep_categories WHERE book_id=?").get(req.params.id).c > 0; } catch(e) { return false; }
  })();
  var hasAIDeepV1 = (() => {
    try { return db.prepare("SELECT COUNT(*) as c FROM book_ai_deep WHERE book_id=? AND status='completed'").get(req.params.id).c > 0; } catch(e) { return false; }
  })();

  res.render("book-detail", { book, chapters, related, summaryMap, downloads, hasQA, hasGlossary, classification: bookCls, knowledge: bookKnowledge, hasAIDeepV2, hasAIDeepV1 });
});

// ===== READER (redirect old /read/:ch to unified reader) =====
app.get('/books/:id/read/:ch', (req, res) => {
  res.redirect(`/books/${req.params.id}/reader#chapter-${req.params.ch}`);
});

// ===== SUMMARY (redirect old /summary/:ch to unified reader) =====
app.get('/books/:id/summary/:ch', (req, res) => {
  res.redirect(`/books/${req.params.id}/reader#chapter-${req.params.ch}`);
});

// ===== DOWNLOAD =====
app.get('/books/:id/download/:downloadId', (req, res) => {
  const db = getDb();
  const download = db.prepare("SELECT * FROM book_downloads WHERE id=? AND book_id=?").get(req.params.downloadId, req.params.id);
  if (!download || !download.file_url) return res.redirect(`/books/${req.params.id}`);
  res.redirect(download.file_url);
});

// ===== READER SINGLE (目录+精读/细读同页) =====
app.get('/books/:id/reader', async (req, res) => {
  const db = getDb();
  const book = db.prepare("SELECT * FROM books WHERE id=? AND status='published'").get(req.params.id);
  if (!book) return res.redirect('/books');
  
  // 仅查询用量（不递增），用于页面显示升级横幅
  const usage = await checkReadingUsage(req);

  const chapters = db.prepare("SELECT id,title,sort_order FROM chapters WHERE book_id=? ORDER BY sort_order").all(book.id);
  const summaryIds = db.prepare("SELECT chapter_id FROM chapter_summaries WHERE chapter_id IN (SELECT id FROM chapters WHERE book_id=?)").all(req.params.id).map(r => r.chapter_id);
  const summaryMap = {};
  summaryIds.forEach(id => { summaryMap[id] = true; });
  res.render('reader-single', { book, chapters, summaryMap, needUpgrade: !usage.ok });
});

// ===== API: Chapter JSON data =====
app.get('/api/books/:id/chapter/:ch', (req, res) => {
  const db = getDb();
  const book = db.prepare("SELECT * FROM books WHERE id=? AND status='published'").get(req.params.id);
  if (!book) return res.json({ ok: false, error: '书未找到' });
  const chapter = db.prepare("SELECT * FROM chapters WHERE id=? AND book_id=?").get(req.params.ch, req.params.id);
  if (!chapter) return res.json({ ok: false, error: '章节未找到' });
  const mode = req.query.mode || 'summary';
  
  // 获取本章图片数据
  let images = [];
  try {
    images = JSON.parse(chapter.images || '[]');
  } catch(e) { images = []; }
  
  if (mode === 'summary') {
    // 精读：递增用量（查看一章精读计数一次）
    incrementReadingUsage(req).then(usage => {
      const summary = db.prepare("SELECT * FROM chapter_summaries WHERE chapter_id=?").get(req.params.ch);
      if (!summary) return res.json({ ok: false, error: '精读总结未找到' });
      const keyPoints = summary.key_points ? summary.key_points.split('|') : [];
      res.json({ ok: true, mode: 'summary', title: chapter.title, content: marked.parse(summary.summary), keyPoints, images, needUpgrade: !usage.ok });
    }).catch(err => {
      console.error('Usage increment error in API:', err.message);
      const summary = db.prepare("SELECT * FROM chapter_summaries WHERE chapter_id=?").get(req.params.ch);
      if (!summary) return res.json({ ok: false, error: '精读总结未找到' });
      const keyPoints = summary.key_points ? summary.key_points.split('|') : [];
      res.json({ ok: true, mode: 'summary', title: chapter.title, content: marked.parse(summary.summary), keyPoints, images, needUpgrade: false });
    });
    return;
  } else {
    // 细读模式：返回原文
    // 优先使用 content_html（已包<p>标签的HTML），无则用 content 自动处理
    let styled = (chapter.content_html || chapter.content) || '';
    // 如果内容已经是 HTML（含标签），直接返回
    if (/<div|<p|<h[1-6]|<span|<blockquote|<figure|<img|<table/.test(styled)) {
      // 已含HTML标签，保持原样
    } else {
      // 纯文本：按空行分段
      styled = styled.split(/\n{2,}/).filter(b => b.trim()).map(b => '<p>' + b.trim().split(/\n/).map(l => l.trim()).join('') + '</p>').join('\n');
    }
    res.json({ ok: true, mode: 'reading', title: chapter.title, content: styled, wordCount: chapter.word_count, images });
  }
});

// ===== QA =====
app.get('/books/:id/qa', (req, res) => {
  const db = getDb();
  const book = db.prepare("SELECT * FROM books WHERE id=? AND status='published'").get(req.params.id);
  if (!book) return res.redirect('/books');
  const qas = db.prepare("SELECT qa.*, c.title as chapter_title FROM book_qa qa LEFT JOIN chapters c ON c.id=qa.chapter_id WHERE qa.book_id=? ORDER BY qa.sort_order").all(req.params.id);
  res.render('qa', { book, qas });
});

app.get('/api/books/:id/qa', (req, res) => {
  const db = getDb();
  const qas = db.prepare("SELECT qa.*, c.title as chapter_title FROM book_qa qa LEFT JOIN chapters c ON c.id=qa.chapter_id WHERE qa.book_id=? ORDER BY qa.sort_order").all(req.params.id);
  res.json({ ok: true, qas });
});

// ===== GLOSSARY =====
app.get('/books/:id/glossary', (req, res) => {
  const db = getDb();
  const book = db.prepare("SELECT * FROM books WHERE id=? AND status='published'").get(req.params.id);
  if (!book) return res.redirect('/books');
  const terms = db.prepare("SELECT * FROM glossary WHERE book_id=? ORDER BY sort_order").all(req.params.id);
  res.render('glossary', { book, terms });
});

app.get('/api/books/:id/glossary', (req, res) => {
  const db = getDb();
  const terms = db.prepare("SELECT * FROM glossary WHERE book_id=? ORDER BY sort_order").all(req.params.id);
  const q = (req.query.q || '').toLowerCase();
  const filtered = q ? terms.filter(t => t.term.toLowerCase().includes(q) || t.explanation.toLowerCase().includes(q)) : terms;
  res.json({ ok: true, terms: filtered });
});

// ===== SEARCH =====
app.get('/api/search', (req, res) => {
  const q = req.query.q;
  if (!q || q.length < 2) return res.json({ books: [] });
  const books = getDb().prepare("SELECT b.id,b.title,b.is_free,c.name as cname FROM books b JOIN categories c ON c.id=b.category_id WHERE b.status='published' AND b.title LIKE ? LIMIT 10").all(`%${q}%`);
  res.json({ books });
});

// ===== ADMIN (keep basic) =====
app.get('/admin', (req, res) => {
  const db = getDb();
  const st = {
    books: db.prepare("SELECT COUNT(*) as c FROM books").get().c,
    chapters: db.prepare("SELECT COUNT(*) as c FROM chapters").get().c,
    summaries: db.prepare("SELECT COUNT(*) as c FROM chapter_summaries").get().c,
  };
  res.render('admin-dashboard', { st });
});
app.get('/admin/books', (req, res) => {
  const books = getDb().prepare("SELECT b.*,c.name as cname FROM books b JOIN categories c ON c.id=b.category_id ORDER BY b.created_at DESC").all();
  res.render('admin-books', { books });
});
app.post('/admin/import', (req, res) => {
  try { importContent(); res.json({ ok: true, msg: '导入完成' }); } catch(e) { res.json({ ok: false, msg: e.message }); }
});

// ===== AI助读 全书 =====
app.get('/books/:id/aideep', async (req, res) => {
  const db = getDb();
  const book = db.prepare("SELECT * FROM books WHERE id=? AND status='published'").get(req.params.id);
  if (!book) return res.redirect('/books');
  
  // 递增用量 + 配额检查
  const usage = await incrementReadingUsage(req, 5);
  if (!usage.ok) {
    return res.send(`
      <html><head><meta charset="utf-8"><title>${book.title} - AI助读</title>
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f8f5f0;margin:0;}</style>
      </head><body>
      <div style="text-align:center;color:#6b7280;">
        <p style="font-size:48px;margin-bottom:16px;">🔒</p>
        <p style="font-size:18px;font-weight:600;color:#1f2937;">免费版AI助读次数已用完</p>
        <p style="font-size:14px;margin-top:8px;color:#9ca3af;">升级VIP即可无限使用AI助读功能</p>
        <a href="https://xianbao.online/vip.html" target="_blank" style="display:inline-block;margin-top:20px;padding:12px 32px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:white;border-radius:100px;text-decoration:none;font-weight:600;">升级VIP →</a>
        <br><a href="/books/${book.id}" style="display:inline-block;margin-top:16px;color:#64748b;font-size:13px;text-decoration:none;">← 返回书籍页</a>
      </div></body></html>
    `);
  }
  
  const aiDeep = db.prepare("SELECT * FROM book_ai_deep WHERE book_id=? AND status='completed'").get(book.id);
  if (!aiDeep) {
    return res.send(`
      <html><head><meta charset="utf-8"><title>${book.title} - AI助读</title>
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f8f5f0;}</style>
      </head><body>
      <div style="text-align:center;color:#6b7280;">
        <p style="font-size:48px;margin-bottom:16px;">🤖</p>
        <p style="font-size:18px;font-weight:600;color:#1f2937;">AI助读报告尚未生成</p>
        <p style="font-size:14px;margin-top:8px;">请先生成全书AI助读后再查看</p>
        <a href="/books/${book.id}" style="display:inline-block;margin-top:20px;padding:10px 24px;background:#7c3aed;color:white;border-radius:100px;text-decoration:none;">返回书籍页</a>
      </div></body></html>
    `);
  }
  
  const htmlContent = aiDeep.content_html || marked.parse(aiDeep.content.toString());
  res.render('aideep', { book, content: htmlContent });
});

// ===== AI助读 V2 =====
app.get('/api/books/:id/aideep-categories', (req, res) => {
  const db = getDb();
  const book = db.prepare("SELECT id, title FROM books WHERE id=?").get(req.params.id);
  if (!book) return res.json({ ok: false, error: '书未找到' });
  const categories = db.prepare("SELECT id, name, slug, description, icon, theme_count, sort_order FROM ai_deep_categories WHERE book_id=? ORDER BY sort_order").all(req.params.id);
  const totalThemes = db.prepare("SELECT COUNT(*) as c FROM ai_deep_themes WHERE book_id=? AND status='completed'").get(req.params.id);
  res.json({ ok: true, book: { id: book.id, title: book.title }, categories, totalThemes: totalThemes.c });
});

app.get('/api/books/:id/aideep-themes/:categoryId', (req, res) => {
  const db = getDb();
  const themes = db.prepare(`SELECT id, title, summary, overview, key_concepts, core_content, related_passages, practical_application, cross_references, content_html, status, sort_order FROM ai_deep_themes WHERE book_id=? AND category_id=? AND status='completed' ORDER BY sort_order`).all(req.params.id, req.params.categoryId);
  const category = db.prepare("SELECT id, name, icon FROM ai_deep_categories WHERE id=?").get(req.params.categoryId);
  const rendered = themes.map(t => ({
    id: t.id, title: t.title, summary: t.summary, overview: t.overview,
    keyConcepts: t.key_concepts ? (() => { try { return JSON.parse(t.key_concepts); } catch(e) { return []; } })() : [],
    coreContent: t.core_content, relatedPassages: t.related_passages,
    practicalApplication: t.practical_application, crossReferences: t.cross_references,
    contentHtml: t.content_html, sortOrder: t.sort_order,
  }));
  res.json({ ok: true, category, themes: rendered });
});

app.get('/books/:id/aideep-v2', async (req, res) => {
  const db = getDb();
  const book = db.prepare("SELECT * FROM books WHERE id=?").get(req.params.id);
  if (!book) return res.redirect('/books');
  
  // 递增用量 + 配额检查
  const usage = await incrementReadingUsage(req, 5);
  if (!usage.ok) {
    return res.send(`
      <html><head><meta charset="utf-8"><title>${book.title} - AI助读</title>
      <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#f8f5f0;margin:0;}</style>
      </head><body>
      <div style="text-align:center;color:#6b7280;">
        <p style="font-size:48px;margin-bottom:16px;">🔒</p>
        <p style="font-size:18px;font-weight:600;color:#1f2937;">免费版AI助读次数已用完</p>
        <p style="font-size:14px;margin-top:8px;color:#9ca3af;">升级VIP即可无限使用AI助读功能</p>
        <a href="https://xianbao.online/vip.html" target="_blank" style="display:inline-block;margin-top:20px;padding:12px 32px;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:white;border-radius:100px;text-decoration:none;font-weight:600;">升级VIP →</a>
        <br><a href="/books/${book.id}" style="display:inline-block;margin-top:16px;color:#64748b;font-size:13px;text-decoration:none;">← 返回书籍页</a>
      </div></body></html>
    `);
  }
  
  const categories = db.prepare("SELECT id, name, slug, description, icon, theme_count, sort_order FROM ai_deep_categories WHERE book_id=? ORDER BY sort_order").all(req.params.id);
  if (categories.length === 0) return res.redirect(`/books/${book.id}/aideep`);
  const totalThemes = db.prepare("SELECT COUNT(*) as c FROM ai_deep_themes WHERE book_id=? AND status='completed'").get(req.params.id);
  res.render('aideep-v2', { book, categories, totalThemes: totalThemes.c });
});

// ===== Error handler =====
app.use((err, req, res, next) => {
  console.error('Route error:', req.path, err.message);
  res.status(500).send('500 Error: ' + err.message);
});

app.listen(3099, () => console.log('✅ 仙宝: http://localhost:3099'));
