const fs = require('fs');
const path = require('path');
const { getDb } = require('../models/database');
const marked = require('marked');

const OUTPUT_DIR = '/home/bosidon/projects/lingxiu/output';

function importContent() {
  const db = getDb();
  const summaryPath = path.join(OUTPUT_DIR, '_summary.json');
  
  if (!fs.existsSync(summaryPath)) {
    console.log('⚠️ No summary file found at', summaryPath);
    return;
  }

  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
  const mdFiles = summary.files || [];
  
  // Map files to categories
  const categoryMap = {
    '赛斯': [1, 'seth'],
    'seth': [1, 'seth'],
    '欧林': [2, 'orin'],
    'oulin': [2, 'orin'],
    '与神对话': [3, 'cwg'],
    '光之手': [4, 'hands-of-light'],
    'guangzhishou': [4, 'hands-of-light'],
    '太傻': [5, 'classics'],
    '一的法则': [5, 'classics'],
    '在觉知中': [5, 'classics'],
    '迈可资料': [5, 'classics'],
    'maike': [5, 'classics'],
  };

  function detectCategory(filename) {
    for (const [key, [catId]] of Object.entries(categoryMap)) {
      if (filename.includes(key)) return catId;
    }
    return 5; // default to classics
  }

  function detectTitle(filename) {
    // Extract meaningful Chinese title
    const name = filename.replace(/\.md$/, '');
    const cleanName = name
      .replace(/^(赛斯|欧林|oulin|maike|guangzhishou)_/, '')
      .replace(/^与神对话_/, '')
      .replace(/_/g, '');
    
    // Try reading first line of markdown
    const mdPath = path.join(OUTPUT_DIR, filename);
    if (fs.existsSync(mdPath)) {
      const content = fs.readFileSync(mdPath, 'utf-8');
      const titleMatch = content.match(/^# (.+)$/m);
      if (titleMatch) return titleMatch[1].trim();
    }
    return cleanName;
  }

  let imported = 0;
  let skipped = 0;

  for (const f of mdFiles) {
    const fname = f.file;
    if (!fname) continue;
    
    const mdFilename = `${fname}.md`;
    const mdPath = path.join(OUTPUT_DIR, mdFilename);
    if (!fs.existsSync(mdPath)) continue;

    const title = detectTitle(mdFilename);
    const catId = detectCategory(fname);
    
    // Check if already exists
    const existing = db.prepare('SELECT id FROM books WHERE title = ?').get(title);
    if (existing) {
      skipped++;
      continue;
    }

    // Read content and split into chapters
    let content = fs.readFileSync(mdPath, 'utf-8');
    // Remove the first h1 title line (already used)
    content = content.replace(/^# .+\n\n/, '');
    // Remove the metadata line
    content = content.replace(/^> .+\n\n/, '');
    
    const chapters = splitIntoChapters(content, title);
    
    const chars = content.length;
    const isFree = (fname.includes('太傻') || fname.includes('喜悦之道') || fname.includes('觉察')) ? 1 : 0;
    const freeStatus = isFree ? '免费' : '会员';

    // Insert book
    const bookResult = db.prepare(`
      INSERT INTO books (title, category_id, description, total_chars, is_free, sort_order, status)
      VALUES (?, ?, ?, ?, ?, ?, 'published')
    `).run(title, catId, `${title} - 共 ${chars.toLocaleString()} 字`, chars, isFree, imported + 1);

    const bookId = bookResult.lastInsertRowid;

    // Insert chapters
    const insertChapter = db.prepare(`
      INSERT INTO chapters (book_id, title, content, content_html, sort_order, word_count)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      const html = marked.parse(ch.content);
      insertChapter.run(bookId, ch.title, ch.content, html, i + 1, ch.content.length);
    }

    // Add to search index
    db.prepare(`
      INSERT INTO search_index (content_type, content_id, title, content)
      VALUES ('book', ?, ?, ?)
    `).run(bookId, title, content.substring(0, 10000));

    imported++;
    console.log(`  ✅ [${freeStatus}] ${title} (${chapters.length}章, ${chars.toLocaleString()}字)`);
  }

  console.log(`\n📊 总计: 导入 ${imported} 本, 跳过 ${skipped} 本 (已存在)`);
}

function splitIntoChapters(content, bookTitle) {
  // Try splitting by "--- 第X页 ---" markers
  const pagePattern = /--- 第(\d+)页 ---\n/g;
  
  // Check if we have page markers
  if (pagePattern.test(content)) {
    pagePattern.lastIndex = 0;
    const parts = content.split(/--- 第\d+页 ---\n/).filter(p => p.trim());
    
    if (parts.length > 1) {
      // Group pages into chapters (roughly every 15-20 pages)
      const pagesPerChapter = Math.max(1, Math.floor(parts.length / 20));
      const chapters = [];
      
      for (let i = 0; i < parts.length; i += pagesPerChapter) {
        const chunk = parts.slice(i, i + pagesPerChapter).join('\n\n').trim();
        const pageStart = i + 1;
        const pageEnd = Math.min(i + pagesPerChapter, parts.length);
        chapters.push({
          title: `第${Math.floor(i / pagesPerChapter) + 1}章 (第${pageStart}-${pageEnd}页)`,
          content: chunk
        });
      }
      return chapters;
    }
  }

  // Otherwise return as single chapter
  return [{
    title: bookTitle,
    content: content.trim()
  }];
}

module.exports = { importContent };
