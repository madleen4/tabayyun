// خادم تبيَّن: بلا مكتبات خارجية (Node 18 أو أحدث).
// - يقدّم الواجهة.
// - يستدعي النموذج اللغوي (المفتاح يبقى في الخادم).
// - البحث في الدرر السنية، واستخدام HadeethEnc للأحاديث الثابتة والبدائل.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { extname, join, normalize as normPath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractWithAI, altQueriesWithAI, rephraseWithAI, baselineWithAI, ocrWithAI, hasKey } from './src/gemini.js';
import { extractByRules } from './src/extract-rules.js';
import { words } from './src/normalize.js';
import { searchDorar } from './src/dorar.js';
import { searchHadeethEnc } from './src/hadeethenc.js';

// قراءة ملف .env إن وُجد (دون مكتبات)
const ENV = fileURLToPath(new URL('./.env', import.meta.url));
if (existsSync(ENV)) {
  for (const line of readFileSync(ENV, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const PUBLIC = fileURLToPath(new URL('./public/', import.meta.url));
const SRC = fileURLToPath(new URL('./src/', import.meta.url));
const CASES = fileURLToPath(new URL('./test/cases.json', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const MAX_TEXT = 8000;        // لكل طلب استخراج؛ النص الطويل يُقسَّم في المتصفح إلى أجزاء
const MAX_REPHRASE = 40000;

// إذا رفضت الدرر الطلبات من الخادم، لا نكررها لمدة 15 دقيقة؛ المتصفح يظل يجرب JSONP مباشرة.
let dorarBlockedUntil = 0;
// إذا تعذّر النموذج اللغوي (ازدحام أو نفاد حصة)، يُستخدم الاستخراج بالقواعد دقيقة واحدة بدل الانتظار في كل طلب.
let aiPausedUntil = 0;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function sendFile(res, file) {
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('غير موجود');
  }
}

function safeJoin(root, rel) {
  const file = normPath(join(root, rel));
  return file.startsWith(root) || file + sep === root ? file : null;
}

function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('TOO_LARGE')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('BAD_JSON')); }
    });
    req.on('error', reject);
  });
}

// لا يُسجَّل نص المستخدم أبداً؛ يُسجَّل نوع الخطأ فقط.
const logErr = (where, err) => console.error(`${where}:`, err.name, '-', err.message);

const api = {
  async config() {
    return { ai: hasKey() };
  },

  async extract(body) {
    const text = String(body.text || '');
    if (!text.trim()) return [400, { error: 'النص فارغ.' }];
    if (text.length > MAX_TEXT) return [400, { error: `النص أطول من ${MAX_TEXT} حرف.` }];
    let engine = 'ai';
    let items = [];
    let rejected = 0;
    try {
      if (Date.now() < aiPausedUntil) throw new Error('AI_PAUSED');
      ({ items, rejected } = await extractWithAI(text));
    } catch (err) {
      if (err.message !== 'NO_KEY' && err.message !== 'AI_PAUSED') {
        logErr('extract', err);
        aiPausedUntil = Date.now() + 30_000;
        console.error('AI paused for 30s; using rules extractor.');
      }
      engine = 'rules';
      items = extractByRules(text);
    }
    return [200, { engine, items, rejected }];
  },

  async 'alt-queries'(body) {
    const quote = String(body.quote || '').slice(0, 600);
    if (!quote) return [400, { error: 'لا يوجد نص.' }];
    try {
      if (Date.now() < aiPausedUntil) throw new Error('AI_PAUSED');
      const ai = await altQueriesWithAI(quote);
      return [200, { engine: 'ai', queries: [...new Set(ai)] }];
    } catch (err) {
      if (err.message !== 'NO_KEY' && err.message !== 'AI_PAUSED') { logErr('alt', err); aiPausedUntil = Date.now() + 30_000; }
      // عند تعذّر النموذج: أطول كلمتين من القول لتكوين عبارة بحث فقط.
      const w = words(quote).filter((x) => x.length > 2).sort((a, b) => b.length - a.length);
      return [200, { engine: 'rules', queries: w.length >= 2 ? [`${w[0]} ${w[1]}`] : w.slice(0, 1) }];
    }
  },

  async rephrase(body) {
    const items = Array.isArray(body.items) ? body.items : [];
    const valid = items.every((it) => Array.isArray(it?.parts) && Array.isArray(it?.quotes) && it.parts.length === it.quotes.length + 1);
    const size = JSON.stringify(items).length;
    if (!items.length || items.length > 200 || !valid || size > MAX_REPHRASE) return [400, { error: 'نص غير صالح.' }];
    try {
      const clean = items.map((it) => ({ parts: it.parts.map(String), quotes: it.quotes.map(String) }));
      return [200, { items: await rephraseWithAI(clean) }];
    } catch (err) {
      if (err.message === 'NO_KEY') return [503, { error: 'تحسين الصياغة يحتاج مفتاح النموذج اللغوي.' }];
      logErr('rephrase', err);
      return [502, { error: 'خدمة الذكاء الاصطناعي مشغولة الآن (حصة الخطة المجانية)، أعد المحاولة بعد دقيقة.' }];
    }
  },

  async ocr(body) {
    const mime = String(body.mime || '');
    const data = String(body.data || '');
    if (!/^(image\/(png|jpeg|webp)|application\/pdf)$/.test(mime) || !data) return [400, { error: 'ملف غير صالح.' }];
    try {
      return [200, { text: await ocrWithAI({ mime, data }) }];
    } catch (err) {
      if (err.message === 'NO_KEY') return [503, { error: 'قراءة الصور تحتاج مفتاح النموذج اللغوي.' }];
      logErr('ocr', err);
      return [502, { error: 'تعذّرت قراءة الصورة الآن، أعد المحاولة بعد قليل.' }];
    }
  },

  async baseline(body) {
    const quote = String(body.quote || '').slice(0, 600);
    try {
      return [200, { answer: await baselineWithAI(quote) }];
    } catch (err) {
      if (err.message === 'NO_KEY') return [503, { error: 'يحتاج مفتاح النموذج اللغوي.' }];
      logErr('baseline', err);
      return [502, { error: 'تعذّر الاتصال بالنموذج.' }];
    }
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = decodeURIComponent(url.pathname);

  if (path.startsWith('/api/')) {
    const name = path.slice(5);
    if (name === 'health') return sendJson(res, 200, { ok: true });
    if (name === 'config' && req.method === 'GET') return sendJson(res, 200, await api.config());
    if (name === 'dorar' && req.method === 'GET') {
      // بحث في الدرر من الخادم (عرض لحظي دون تخزين). إن رفضت الدرر، يجرّب المتصفح طريقة JSONP.
      const q = (url.searchParams.get('q') || '').trim().slice(0, 300);
      if (!q) return sendJson(res, 400, { error: 'لا يوجد نص.' });
      if (Date.now() < dorarBlockedUntil) return sendJson(res, 503, { error: 'Dorar blocked' });
      try {
        return sendJson(res, 200, { results: await searchDorar(q) });
      } catch (err) {
        logErr('dorar', err);
        if (/403|abort/i.test(err.message + err.name)) {
          dorarBlockedUntil = Date.now() + 15 * 60_000;
          console.error('Dorar refused server-side requests for 15 minutes; browser JSONP will still be tried.');
        }
        return sendJson(res, 502, { error: err.message });
      }
    }
    if (name === 'hadeethenc' && req.method === 'GET') {
      // HadeethEnc: المصدر المعتمد في تبيَّن للأحاديث الثابتة والمطابقة والبدائل.
      const q = (url.searchParams.get('q') || '').trim().slice(0, 300);
      if (!q) return sendJson(res, 400, { error: 'لا يوجد نص.' });
      try {
        return sendJson(res, 200, { results: await searchHadeethEnc(q) });
      } catch (err) {
        logErr('hadeethenc', err);
        return sendJson(res, 502, { error: 'تعذّر الوصول إلى موسوعة الأحاديث النبوية.' });
      }
    }
    if (req.method !== 'POST' || !api[name] || name === 'config') return sendJson(res, 404, { error: 'غير موجود' });
    try {
      const body = await readBody(req, name === 'ocr' ? 20 * 1024 * 1024 : undefined);
      const [status, out] = await api[name](body);
      return sendJson(res, status, out);
    } catch (err) {
      return sendJson(res, err.message === 'TOO_LARGE' ? 413 : 400, { error: 'طلب غير صالح.' });
    }
  }

  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  if (path === '/cases.json') return sendFile(res, CASES);
  if (path.startsWith('/lib/') && path.endsWith('.js')) {
    const file = safeJoin(SRC, path.slice('/lib/'.length));
    if (file) return sendFile(res, file);
  }
  const file = safeJoin(PUBLIC, path === '/' ? 'index.html' : path.slice(1));
  if (!file) { res.writeHead(403); return res.end(); }
  return sendFile(res, file);
});

server.listen(PORT, () => {
  console.log(`Tabayyun running on http://localhost:${PORT} (AI: ${hasKey() ? 'on' : 'off'})`);
});