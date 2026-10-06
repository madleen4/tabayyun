// تبديل المفاتيح والنماذج عند نفاد الحصة، بخدمة وهمية (لا اتصال حقيقي).
import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '../src/gemini.js';

function fakeFetch(exhaustedKeys) {
  const calls = [];
  const fn = async (url, opts) => {
    const key = opts.headers['x-goog-api-key'];
    calls.push(key);
    const json = (status, body) => ({ ok: status === 200, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (url.includes('/models?')) return json(200, { models: [{ name: 'models/gemini-9-flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-9-flash-lite', supportedGenerationMethods: ['generateContent'] }] });
    if (exhaustedKeys.includes(key)) return json(429, { error: { code: 429, message: 'quota' } });
    return json(200, { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] });
  };
  fn.calls = calls;
  return fn;
}

test('إذا نفدت حصة المفتاح الأول يُستخدم المفتاح الثاني', async () => {
  process.env.GEMINI_API_KEY = 'k1, k2';
  const f = fakeFetch(['k1']);
  assert.deepEqual(await generate('x', { fetchImpl: f }), { ok: true });
  assert.ok(f.calls.includes('k2'));
});

test('بلا مفتاح: خطأ واضح دون أي اتصال', async () => {
  process.env.GEMINI_API_KEY = '';
  await assert.rejects(generate('x', { fetchImpl: fakeFetch([]) }), /NO_KEY/);
});

test('إذا نفدت حصة كل المفاتيح يُرمى الخطأ لتعمل الأداة بالقواعد', async () => {
  process.env.GEMINI_API_KEY = 'a1,a2';
  await assert.rejects(generate('x', { fetchImpl: fakeFetch(['a1', 'a2']) }), /429/);
});

test('النموذج الذي نفدت حصته أو لم يعد متاحاً يُتخطّى إلى نموذج يعمل', async () => {
  process.env.GEMINI_API_KEY = 'm1';
  const tried = [];
  const f = async (url, opts) => {
    const json = (status, body) => ({ ok: status === 200, status, json: async () => body, text: async () => JSON.stringify(body) });
    if (url.includes('/models?')) return json(200, { models: ['gemini-9-flash', 'gemini-8-flash', 'gemini-flash-latest', 'gemini-flash-lite-latest'].map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] })) });
    const model = url.match(/models\/([^:]+):/)[1];
    tried.push(model);
    if (model === 'gemini-9-flash' || model === 'gemini-8-flash') return json(404, { error: { message: 'no longer available' } });
    if (model === 'gemini-flash-latest') return json(429, { error: { message: 'quota' } });
    return json(200, { candidates: [{ content: { parts: [{ text: '{"ok":1}' }] } }] });
  };
  assert.deepEqual(await generate('x', { fetchImpl: f }), { ok: 1 });
  tried.length = 0;
  assert.deepEqual(await generate('x', { fetchImpl: f }), { ok: 1 });
  assert.deepEqual(tried, ['gemini-flash-lite-latest']); // المرة الثانية: مباشرة إلى النموذج العامل
});
