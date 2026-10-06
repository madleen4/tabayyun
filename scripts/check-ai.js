// فحص مفاتيح Gemini: يجرّب كل مفتاح على أول النماذج، ويطبع النتيجة دون إظهار المفتاح.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ENV = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(ENV)) {
  for (const line of readFileSync(ENV, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const BASE = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
const keys = String(process.env.GEMINI_API_KEY || '').split(',').map((k) => k.trim()).filter(Boolean);
if (!keys.length) { console.log('لا يوجد مفتاح في ملف .env (GEMINI_API_KEY).'); process.exit(1); }
console.log(`عدد المفاتيح: ${keys.length}`);

for (const [i, key] of keys.entries()) {
  const tag = `المفتاح ${i + 1} (ينتهي بـ …${key.slice(-4)})`;
  const res = await fetch(`${BASE}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  if (!res.ok) { console.log(`${tag}: غير صالح (HTTP ${res.status})`); continue; }
  const { models = [] } = await res.json();
  const names = models.filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, '')).filter((n) => /flash/.test(n) && !/(image|tts|audio|live)/.test(n)).slice(0, 4);
  for (const model of names) {
    const r = await fetch(`${BASE}/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'قل: نعم' }] }] }),
    });
    const body = await r.text();
    const why = r.ok ? 'يعمل ✓' : `HTTP ${r.status} ${(body.match(/"message":\s*"([^"]{0,90})/) || [])[1] || ''}`;
    console.log(`${tag} · ${model}: ${why}`);
  }
}