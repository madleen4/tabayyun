import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDorarHtml, parseDorarResponse, searchDorar, dorarSearchLink } from '../src/dorar.js';

const html = await readFile(new URL('./fixtures/dorar-sample.html', import.meta.url), 'utf8');

test('يستخرج كل الأحاديث من استجابة الدرر', () => {
  assert.equal(parseDorarHtml(html).length, 2);
});

test('يستخرج النص والحقول من البطاقة الأولى', () => {
  const [r] = parseDorarHtml(html);
  assert.equal(r.text, 'إنَّما الأعمالُ بالنياتِ');
  assert.equal(r.truncated, true);
  assert.equal(r.rawi, 'أبو سعيد الخدري');
  assert.equal(r.muhaddith, 'ابن عبدالبر');
  assert.equal(r.source, 'التمهيد');
  assert.equal(r.number, '21/270');
  assert.match(r.ruling, /^خطأ/);
});

test('يتحمل غياب بعض الحقول ويفك الرموز', () => {
  const r = parseDorarHtml(html)[1];
  assert.equal(r.text, 'مثالٌ ثانٍ "للاختبار"');
  assert.equal(r.muhaddith, '');
  assert.equal(r.ruling, 'صحيح');
});

test('استجابة فارغة تعطي قائمة فارغة', () => {
  assert.deepEqual(parseDorarHtml(''), []);
});

test('searchDorar يقرأ ahadith.result من JSON', async () => {
  const fakeFetch = async (url) => {
    assert.match(url, /dorar_api\.json\?skey=/);
    return { ok: true, text: async () => '\uFEFF' + JSON.stringify({ ahadith: { result: html } }) };
  };
  const results = await searchDorar('إنما الأعمال', { fetchImpl: fakeFetch });
  assert.equal(results.length, 2);
});

test('searchDorar يرمي خطأ عند فشل الخدمة', async () => {
  const fakeFetch = async () => ({ ok: false, status: 503 });
  await assert.rejects(searchDorar('x', { fetchImpl: fakeFetch }));
});

test('رابط البحث في الدرر مُرمَّز', () => {
  assert.equal(dorarSearchLink('الدين النصيحة'), 'https://dorar.net/hadith/search?q=' + encodeURIComponent('الدين النصيحة'));
});

test('searchDorar يرمي خطأ واضحاً إذا لم تكن الاستجابة JSON', async () => {
  const fakeFetch = async () => ({ ok: true, text: async () => '<html>blocked</html>' });
  await assert.rejects(searchDorar('x', { fetchImpl: fakeFetch }), /non-JSON/);
});

test('parseDorarResponse يقبل غلاف JSONP', () => {
  const raw = 'cb_1(' + JSON.stringify({ ahadith: { result: html } }) + ');';
  assert.equal(parseDorarResponse(raw).length, 2);
});
