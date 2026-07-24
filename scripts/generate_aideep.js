#!/usr/bin/env node
/**
 * 灵修阅读站 — AI精读生成脚本
 * 使用说明:
 *   node scripts/generate_aideep.js --book=88          # 为指定的书生成精读
 *   node scripts/generate_aideep.js --all               # 为所有缺少精读的书生成
 *   node scripts/generate_aideep.js --book=88 --dry-run # 预览不执行
 *
 * 环境变量: DEEPSEEK_API_KEY (或从 /var/www/.env 读取)
 */

const fs = require('fs');
const path = require('path');

// ====== 配置 ======
const ENV_PATH = '/var/www/.env';
const DB_PATH = path.join(__dirname, '..', 'data', 'xianbao.db');
const API_KEY = process.env.DEEPSEEK_API_KEY || loadEnv().DEEPSEEK_API_KEY || '';
const API_URL = 'https://api.deepseek.com/v1/chat/completions';
const DRY_RUN = process.argv.includes('--dry-run');
const TARGET_BOOK = parseArg('--book');
const RUN_ALL = process.argv.includes('--all');

// ====== 工具函数 ======

function loadEnv() {
  try {
    const content = fs.readFileSync(ENV_PATH, 'utf8');
    const env = {};
    content.split(/[\r\n]+/).filter(Boolean).forEach(function(line) {
      const m = line.match(/^\s*([^=#]+?)\s*=\s*(.+?)\s*$/);
      if (m && !m[1].startsWith('#')) env[m[1].trim()] = m[2].trim();
    });
    return env;
  } catch(e) {
    console.error('⚠️  加载 .env 失败:', e.message);
    return {};
  }
}

function parseArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && idx + 1 < process.argv.length && !process.argv[idx + 1].startsWith('--')) return process.argv[idx + 1];
  for (const a of process.argv) {
    if (a.startsWith(name + '=')) return a.split('=')[1];
  }
  return null;
}

// ====== DeepSeek 调用 ======

async function callDeepSeek(systemPrompt, userPrompt, maxTokens = 4096) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.6,
      max_tokens: maxTokens,
      stream: false,
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  return data.choices[0].message.content;
}

// ====== SQLite 操作 ======

function getDb() {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  return db;
}

// ====== 生成精读分类和主题 ======

const CATEGORIES_SYSTEM_PROMPT = `你是一位资深灵性书籍编辑。你的任务是为一本书设计精读分类和主题。

要求：
1. 分析全书内容，设计 5-8 个分类，每个分类包含 4-6 个精读主题
2. 分类要有逻辑递进关系，覆盖全书核心内容
3. 每个主题要精炼，让读者一眼知道这个主题讲什么
4. 返回 JSON 格式，不要有其他文字

输出格式：
[
  {
    "name": "分类名称",
    "slug": "分类英文slug",
    "description": "分类简介（一句话）",
    "icon": "emoji图标",
    "sort_order": 1,
    "themes": [
      {
        "title": "主题标题",
        "summary": "一句话概括",
        "overview": "概述（100-200字）",
        "keyConcepts": ["核心概念1", "核心概念2"],
        "coreContent": "详细内容解读（300-500字）",
        "relatedPassages": "相关原文引用（可选）",
        "practicalApplication": "实践应用建议（100-200字）",
        "sort_order": 1
      }
    ]
  }
]`;

const AIDEEP_SYSTEM_PROMPT = `你是一位资深的灵性书籍导读专家。你的任务是为一本书撰写全书AI助读报告。

要求：
1. 整体把握书的核心理念和框架
2. 用通俗易懂的语言，让初次接触的读者也能理解
3. 结构清晰，有层次感
4. 字数 3000-5000 字
5. 返回纯 Markdown 格式，不要 JSON

报告结构：
### 引言：这本书在讲什么

### [核心主题1]

### [核心主题2]

### [核心主题3]

...以此类推

### 结语：如何阅读这本书`;

// ====== 主逻辑 ======

async function generateForBook(bookId, bookTitle, chapters) {
  console.log(`\n📖 ${bookTitle}（ID: ${bookId}）`);

  // 拼接章节内容（截取前 60000 字给 AI）
  const fullContent = chapters.map(function(c) {
    return '## ' + c.title + '\n\n' + c.content;
  }).join('\n\n---\n\n');
  const truncatedContent = fullContent.substring(0, 60000);
  console.log(`   章节数: ${chapters.length}, 内容长度: ${fullContent.length} 字（截取 ${truncatedContent.length} 字给AI）`);

  // Step 1: 生成精读分类和主题
  console.log('   🤖 正在生成精读分类和主题...');
  let categories;
  try {
    const userPrompt = '以下是《' + bookTitle + '》的全部章节内容：\n\n' + truncatedContent + '\n\n请为这本书设计精读分类和主题，返回 JSON 格式。';
    const raw = await callDeepSeek(CATEGORIES_SYSTEM_PROMPT, userPrompt, 8192);
    // 提取 JSON
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('AI 返回非 JSON 格式: ' + raw.substring(0, 200));
    categories = JSON.parse(jsonMatch[0]);
    console.log('   ✅ 生成 ' + categories.length + ' 个分类，共 ' + categories.reduce(function(s, c) { return s + c.themes.length; }, 0) + ' 个主题');
  } catch(e) {
    console.error('   ❌ 生成分类失败:', e.message);
    return false;
  }

  if (DRY_RUN) {
    console.log('\n   📋 预览分类:');
    categories.forEach(function(c) {
      console.log('     ' + c.icon + ' ' + c.name + ' (' + c.themes.length + '个主题)');
      c.themes.forEach(function(t) { console.log('       - ' + t.title); });
    });
    console.log('\n   ⏭️  Dry-run 模式，不写入数据库');
    return true;
  }

  // Step 2: 写入数据库
  const db = getDb();
  try {
    // 清除旧的分类和主题
    const oldCats = db.prepare("SELECT id FROM ai_deep_categories WHERE book_id=?").all(parseInt(bookId));
    oldCats.forEach(function(c) {
      db.prepare("DELETE FROM ai_deep_themes WHERE category_id=?").run(c.id);
    });
    db.prepare("DELETE FROM ai_deep_categories WHERE book_id=?").run(parseInt(bookId));

    // 写入新分类
    const insertCat = db.prepare("INSERT INTO ai_deep_categories (book_id, name, slug, description, icon, theme_count, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const insertTheme = db.prepare(`INSERT INTO ai_deep_themes 
      (book_id, category_id, title, summary, overview, key_concepts, core_content, related_passages, practical_application, content_html, status, sort_order) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?)`);

    const transaction = db.transaction(function() {
      categories.forEach(function(cat) {
        const result = insertCat.run(parseInt(bookId), cat.name, cat.slug || cat.name, cat.description || '', cat.icon || '📖', cat.themes.length, cat.sort_order);
        const catId = result.lastInsertRowid;
        cat.themes.forEach(function(theme) {
          const keyConceptsJson = JSON.stringify(theme.keyConcepts || []);
          const contentHtml = '<h3>' + theme.title + '</h3>\n<p><strong>' + theme.summary + '</strong></p>\n<p>' + (theme.overview || '') + '</p>\n<div class="aideep-body">' + (theme.coreContent || '') + '</div>\n' + (theme.practicalApplication ? '<div class="aideep-practice"><h4>实践应用</h4><p>' + theme.practicalApplication + '</p></div>' : '');
          insertTheme.run(parseInt(bookId), catId, theme.title, theme.summary || '', theme.overview || '', keyConceptsJson, theme.coreContent || '', theme.relatedPassages || '', theme.practicalApplication || '', contentHtml, theme.sort_order);
        });
      });
    });
    transaction();
    console.log('   ✅ 已写入数据库');
  } catch(e) {
    console.error('   ❌ 写入数据库失败:', e.message);
    db.close();
    return false;
  }
  db.close();
  return true;
}

async function generateAideepReport(bookId, bookTitle, chapters) {
  console.log('   🤖 正在生成全书AI助读报告...');
  const fullContent = chapters.map(function(c) {
    return '## ' + c.title + '\n\n' + c.content;
  }).join('\n\n---\n\n');
  const truncatedContent = fullContent.substring(0, 50000);

  try {
    const userPrompt = '以下是《' + bookTitle + '》的全部章节内容：\n\n' + truncatedContent + '\n\n请为这本书撰写一份完整的AI助读报告。';
    const report = await callDeepSeek(AIDEEP_SYSTEM_PROMPT, userPrompt, 8192);

    if (DRY_RUN) {
      console.log('   📋 助读报告预览（前200字）:', report.substring(0, 200));
      return true;
    }

    const db = getDb();
    const htmlContent = report.replace(/\n/g, '<br>\n');
    const existing = db.prepare("SELECT id FROM book_ai_deep WHERE book_id=?").get(parseInt(bookId));
    if (existing) {
      db.prepare("UPDATE book_ai_deep SET content=?, content_html=?, status='completed', updated_at=datetime('now','localtime') WHERE book_id=?").run(report, htmlContent, parseInt(bookId));
    } else {
      db.prepare("INSERT INTO book_ai_deep (book_id, content, content_html, status) VALUES (?, ?, ?, 'completed')").run(parseInt(bookId), report, htmlContent);
    }
    db.close();
    console.log('   ✅ 助读报告已保存（' + report.length + ' 字）');
    return true;
  } catch(e) {
    console.error('   ❌ 生成助读报告失败:', e.message);
    return false;
  }
}

async function main() {
  console.log('========================================');
  console.log('  灵修阅读站 — AI精读生成脚本');
  console.log('  ' + new Date().toLocaleString());
  console.log('========================================');
  console.log('  API Key: ' + (API_KEY ? API_KEY.substring(0, 10) + '...' : '❌ 未配置'));
  if (DRY_RUN) console.log('  模式: Dry-run（仅预览）');
  console.log('');

  if (!API_KEY) {
    console.error('❌ 请配置 DEEPSEEK_API_KEY 环境变量');
    process.exit(1);
  }

  const db = getDb();

  // 获取目标书籍
  let books;
  if (TARGET_BOOK) {
    books = db.prepare("SELECT id, title FROM books WHERE id=?").all(parseInt(TARGET_BOOK));
    if (books.length === 0) {
      console.error('❌ 未找到 ID 为 ' + TARGET_BOOK + ' 的书籍');
      db.close();
      process.exit(1);
    }
  } else if (RUN_ALL) {
    books = db.prepare("SELECT b.id, b.title FROM books b LEFT JOIN ai_deep_categories c ON c.book_id=b.id WHERE c.id IS NULL AND b.status='published' ORDER BY b.id").all();
    console.log('📚 找到 ' + books.length + ' 本缺精读的书籍');
  } else {
    console.error('❌ 请指定 --book=ID 或 --all');
    db.close();
    process.exit(1);
  }

  db.close();

  // 逐本处理
  let success = 0, fail = 0;
  for (const book of books) {
    console.log('\n' + '='.repeat(50));
    const chapters = getDb().prepare("SELECT title, content FROM chapters WHERE book_id=? ORDER BY id").all(book.id);
    if (chapters.length === 0) {
      console.log('⚠️  ' + book.title + ' 无章节内容，跳过');
      continue;
    }

    const ok1 = await generateForBook(book.id, book.title, chapters);
    if (ok1) {
      const ok2 = await generateAideepReport(book.id, book.title, chapters);
      if (ok2) success++; else fail++;
    } else {
      fail++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('📊 完成: 成功 ' + success + ' 本, 失败 ' + fail + ' 本');
  if (DRY_RUN) console.log('⏭️  Dry-run 模式，数据库未修改');
}

main().catch(function(e) {
  console.error('❌ 脚本错误:', e.message);
  process.exit(1);
});
