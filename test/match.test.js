import test from 'node:test';
import assert from 'node:assert/strict';
import { similarity, alignDiff, pickMatches, MATCH_THRESHOLD } from '../src/match.js';
import { locate } from '../src/normalize.js';
import { extractByRules } from '../src/extract-rules.js';

test('التشابه يتجاهل التشكيل', () => {
  assert.equal(similarity('الدين النصيحة', 'إنَّ الدِّينَ النَّصيحةُ').score, 1);
});

test('حديث مختلف لا يطابق', () => {
  assert.ok(similarity('الدين النصيحة', 'شين الدين الطمع').score < 0.6);
});

test('كشف التحريف: النوايا بدل النيات', () => {
  const d = alignDiff('إنما الأعمال بالنوايا', 'إنَّما الأعمالُ بالنياتِ، وإنما لكل امرئ ما نوى');
  assert.equal(d.distorted, true);
  assert.deepEqual(d.userWords.map((w) => w.ok), [true, true, false]);
  assert.equal(d.sourceWindow, 'إنَّما الأعمالُ بالنياتِ');
});

test('لا تحريف عند تطابق اللفظ مع اختلاف التشكيل فقط', () => {
  const d = alignDiff('إنما الأعمال بالنيات', 'إنَّما الأعمالُ بالنياتِ . . .');
  assert.equal(d.distorted, false);
  assert.equal(d.sourceWindow, 'إنَّما الأعمالُ بالنياتِ');
});

test('اختيار المطابقات وتجاهل غيرها', () => {
  const results = [
    { text: 'شينُ الدِّينِ الطمع' },
    { text: 'إنَّ الدِّينَ النَّصيحةُ' },
    { text: 'الدِّينُ النَّصيحةُ قلنا لمن' },
  ];
  const { best, matched } = pickMatches('الدين النصيحة', results);
  assert.ok(best);
  assert.equal(matched.length, 2);
});

test('لا مطابقة = لا best', () => {
  assert.equal(pickMatches('نص مختلق تماما هنا', [{ text: 'إنما الأعمال بالنيات' }]).best, null);
});

test('تحديد موضع المقطع في النص متجاهلاً التشكيل', () => {
  const text = 'قال ﷺ: «إنَّما الأعمالُ بالنِّيَّات» فلنصحح';
  const pos = locate(text, 'إنما الأعمال بالنيات');
  assert.equal(text.slice(pos.start, pos.end), 'إنَّما الأعمالُ بالنِّيَّات');
});

test('الاستخراج بالقواعد: بعد عبارة النسبة فقط', () => {
  const t = 'قال رسول الله ﷺ: «الدين النصيحة». وقال الشاعر: «العلم نور».';
  const items = extractByRules(t);
  assert.equal(items.length, 1);
  assert.equal(items[0].quote, 'الدين النصيحة');
  assert.equal(t.slice(items[0].start, items[0].end), 'الدين النصيحة');
});

import { verifyAyah } from '../src/quran.js';
test('التحقق من الآية من المصدر', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ result: { arabic_text: 'إِنَّ مَعَ الْعُسْرِ يُسْرًا' } }) });
  const r = await verifyAyah('إن مع العسر يسرا', 94, 6, { fetchImpl: fakeFetch });
  assert.equal(r.verified, true);
  assert.equal(r.suraName, 'الشرح');
});
test('رفض آية لا يطابق نصها المصدر', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ({ result: { arabic_text: 'فَإِنَّ مَعَ الْعُسْرِ يُسْرًا' } }) });
  assert.equal((await verifyAyah('الدين النصيحة', 94, 5, { fetchImpl: fakeFetch })).verified, false);
});
test('رقم سورة غير صالح', async () => {
  assert.equal((await verifyAyah('x', 200, 1)).verified, false);
});

test('كلمات متفرقة في نص طويل لا تُعد تطابقاً', () => {
  const long = 'إني خشيت أن يكون عذابا سلط على أمتي ويقول إذا رأى المطر رحمة';
  assert.ok(similarity('اختلاف أمتي رحمة', long).score < MATCH_THRESHOLD);
  assert.ok(similarity('إنما الأعمال بالنوايا', 'إنما الأعمال بالنيات وإنما لكل امرئ ما نوى').score >= MATCH_THRESHOLD);
});

test('واو العطف في أول الكلمة لا تُعد تحريفاً', () => {
  assert.equal(alignDiff('الكلمة الطيبة صدقة', 'والكلمة الطيبة صدقة').distorted, false);
  assert.equal(alignDiff('الطهور نصف الإيمان', 'الطهور شطر الإيمان').distorted, true);
});
