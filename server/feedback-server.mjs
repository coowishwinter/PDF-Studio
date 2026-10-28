#!/usr/bin/env node
/**
 * 简页 · 建议收集服务
 * 极简依赖（仅 Node 内置模块）：接收建议 → 追加写入 data/feedback.jsonl
 * 环境变量：
 *   PORT                 监听端口，默认 8787
 *   DATA_DIR             数据目录，默认 ./data
 *   FEEDBACK_ADMIN_TOKEN 管理页/导出令牌；未设置则管理页不可用
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const ADMIN_TOKEN = process.env.FEEDBACK_ADMIN_TOKEN || '';
const FILE = path.join(DATA_DIR, 'feedback.jsonl');
const MAX_BODY = 16 * 1024;
const TYPES = new Set(['suggestion', 'bug', 'experience']);

fs.mkdirSync(DATA_DIR, { recursive: true });

/** 简易内存限流：每 IP 10 分钟 5 条，每天 40 条 */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const dayAgo = now - 24 * 3600 * 1000;
  const list = (hits.get(ip) || []).filter((t) => t > dayAgo);
  const recent = list.filter((t) => t > now - 10 * 60 * 1000);
  if (recent.length >= 5 || list.length >= 40) return true;
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

function sanitize(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function readAll() {
  try {
    const txt = await fsp.readFile(FILE, 'utf8');
    return txt
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

function fmtTime(ts) {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(new Date(ts));
  } catch { return String(ts); }
}

const TYPE_LABEL = { suggestion: '功能建议', bug: '问题反馈', experience: '使用体验' };

function adminPage(rows, filter) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayCount = rows.filter((r) => r.ts >= today.getTime()).length;
  const counts = rows.reduce((a, r) => ((a[r.type] = (a[r.type] || 0) + 1), a), {});
  const tabs = [['', '全部'], ['suggestion', '功能建议'], ['bug', '问题反馈'], ['experience', '使用体验']]
    .map(([k, label]) => `<a class="tab ${filter === k ? 'on' : ''}" href="?token=${encodeURIComponent(ADMIN_TOKEN)}${k ? '&type=' + k : ''}">${label}</a>`)
    .join('');
  const items = rows
    .map((r) => `<article class="card">
      <header><span class="badge t-${esc(r.type)}">${esc(TYPE_LABEL[r.type] || r.type)}</span>
        <time>${esc(fmtTime(r.ts))}</time>
        <span class="meta">${esc(r.page || '')}</span></header>
      <p class="content">${esc(r.content).replace(/\n/g, '<br>')}</p>
      <footer>${r.contact ? '<span>联系方式：' + esc(r.contact) + '</span>' : '<span class="dim">未留联系方式</span>'}
        <span class="dim">IP ${esc(r.ip)} · ${esc((r.ua || '').slice(0, 60))}</span></footer>
    </article>`)
    .join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>简页 · 建议箱</title>
<style>
  :root{color-scheme:light dark}
  *{box-sizing:border-box}
  body{margin:0;padding:24px;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;background:#f8fafc;color:#0f172a}
  h1{font-size:18px;margin:0}
  .top{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px}
  .stat{color:#64748b;font-size:12px}
  .tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}
  .tab{padding:5px 10px;border-radius:999px;border:1px solid #e2e8f0;color:#475569;text-decoration:none;font-size:12px;background:#fff}
  .tab.on{background:#2563eb;border-color:#2563eb;color:#fff}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:10px}
  .card header{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:#64748b}
  .badge{font-size:11px;font-weight:600;padding:1px 8px;border-radius:999px}
  .t-suggestion{background:#dbeafe;color:#1d4ed8}
  .t-bug{background:#fee2e2;color:#b91c1c}
  .t-experience{background:#dcfce7;color:#15803d}
  .content{margin:8px 0;white-space:normal;word-break:break-word}
  .card footer{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:11px;color:#64748b}
  .dim{opacity:.7}
  .empty{color:#64748b;text-align:center;padding:40px 0}
  @media (prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}.card,.tab{background:#1e293b;border-color:#334155;color:#cbd5e1}.tab.on{background:#2563eb;color:#fff}.stat,.card header,.card footer{color:#94a3b8}}
</style></head><body>
<div class="top"><h1>简页 · 建议箱</h1>
  <span class="stat">共 ${rows.length} 条 · 今天 ${todayCount} 条 · 建议 ${counts.suggestion || 0} / 问题 ${counts.bug || 0} / 体验 ${counts.experience || 0}</span>
  <span style="flex:1"></span>
  <a class="tab" href="?token=${encodeURIComponent(ADMIN_TOKEN)}&format=json">导出 JSON</a>
</div>
<div class="tabs">${tabs}</div>
${items || '<div class="empty">还没有收到建议</div>'}
</body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  const p = url.pathname;

  if (p === '/health') return json(res, 200, { ok: true, service: 'jianye-feedback' });

  if (p === '/feedback' && req.method === 'POST') {
    const ip = clientIp(req);
    if (rateLimited(ip)) return json(res, 429, { ok: false, error: 'rate_limited', message: '提交太频繁了，请稍后再试' });
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      return json(res, 400, { ok: false, error: 'bad_request', message: '请求格式有误' });
    }
    // 蜜罐：真人看不到这个字段
    if (sanitize(body.website, 100)) return json(res, 200, { ok: true });
    const elapsed = Number(body.elapsedMs || 0);
    if (elapsed && elapsed < 800) return json(res, 200, { ok: true });

    const type = TYPES.has(body.type) ? body.type : 'suggestion';
    const content = sanitize(body.content, 2000);
    const contact = sanitize(body.contact, 120);
    if (content.length < 2) return json(res, 400, { ok: false, error: 'content_required', message: '请写下你的建议' });
    if (content.length > 2000) return json(res, 400, { ok: false, error: 'content_too_long', message: '内容太长了' });

    const rec = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      type,
      content,
      contact,
      page: sanitize(body.page, 200),
      referer: sanitize(req.headers.referer || '', 300),
      ip,
      ua: sanitize(req.headers['user-agent'] || '', 300),
    };
    try {
      await fsp.appendFile(FILE, JSON.stringify(rec) + '\n', 'utf8');
    } catch (e) {
      console.error('[feedback] write failed', e);
      return json(res, 500, { ok: false, error: 'storage_failed', message: '保存失败，请稍后再试' });
    }
    return json(res, 200, { ok: true });
  }

  if ((p === '/admin' || p === '/admin.json') && req.method === 'GET') {
    if (!ADMIN_TOKEN) return json(res, 503, { ok: false, error: 'admin_disabled' });
    if (url.searchParams.get('token') !== ADMIN_TOKEN) return json(res, 401, { ok: false, error: 'unauthorized' });
    const rows = (await readAll())
      .filter((r) => !url.searchParams.get('type') || r.type === url.searchParams.get('type'))
      .sort((a, b) => b.ts - a.ts);
    if (p === '/admin.json' || url.searchParams.get('format') === 'json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, count: rows.length, items: rows }, null, 2));
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    return res.end(adminPage(rows, url.searchParams.get('type') || ''));
  }

  return json(res, 404, { ok: false, error: 'not_found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[feedback] listening on ' + PORT + ', data: ' + FILE + ', admin: ' + (ADMIN_TOKEN ? 'on' : 'off'));
});
