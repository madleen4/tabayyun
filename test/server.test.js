// الخادم: النقاط الأساسية تعمل، والطلبات غير الصالحة تُرفض، ويعمل الاستخراج بالقواعد إذا تعذّر النموذج.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
let proc;

test.before(async () => {
  // مفتاح وهمي وعنوان لا يرد: يُختبر السلوك عند تعطل النموذج دون استدعاء خدمة حقيقية
  proc = spawn(process.execPath, [fileURLToPath(new URL('../server.js', import.meta.url))], {
    env: { ...process.env, PORT: String(PORT), GEMINI_API_KEY: 'test-key', GEMINI_BASE_URL: 'http://127.0.0.1:9' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
test.after(() => proc?.kill());

const post = (path, body) => fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('الصفحات الأساسية تُفتح', async () => {
  for (const p of ['/', '/cases.html', '/app.js', '/pipeline.js', '/docx.js', '/lib/text-ops.js', '/lib/match.js', '/cases.json']) {
    assert.equal((await fetch(`${BASE}${p}`)).status, 200, p);
  }
});

test('لا يمكن قراءة ملفات خارج المجلد العام (مثل .env)', async () => {
  for (const p of ['/../.env', '/..%2f.env', '/lib/../server.js']) {
    assert.notEqual((await fetch(`${BASE}${p}`)).status, 200, p);
  }
});

test('الاستخراج يعمل بالقواعد إذا تعذّر النموذج', async () => {
  const r = await post('/api/extract', { text: 'قال رسول الله ﷺ: «الدين النصيحة».' });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.engine, 'rules');
  assert.equal(j.items[0].quote, 'الدين النصيحة');
});

test('رفض الطلبات غير الصالحة', async () => {
  assert.equal((await post('/api/extract', { text: '' })).status, 400);
  assert.equal((await post('/api/rephrase', { items: [] })).status, 400);
  assert.equal((await post('/api/rephrase', { items: [{ parts: ['أ'], quotes: ['ب'] }] })).status, 400);
  assert.equal((await post('/api/ocr', { mime: 'text/html', data: 'x' })).status, 400);
  assert.equal((await fetch(`${BASE}/api/unknown`, { method: 'POST', body: '{}' })).status, 404);
});

test('تحسين الصياغة يرد برسالة واضحة إذا تعذّر النموذج', async () => {
  const r = await post('/api/rephrase', { items: [{ parts: ['طلب العلم من أعظم القربات.'], quotes: [] }] });
  assert.ok([502, 503].includes(r.status));
  assert.ok((await r.json()).error);
});