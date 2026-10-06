// الأقوال المشهورة خارج الكتب الستة والموطأ، والاستخراج بالقواعد.
import test from 'node:test';
import assert from 'node:assert/strict';
import { searchKnown } from '../src/localdb.js';
import { decideStatus } from '../src/classify.js';
import { extractByRules } from '../src/extract-rules.js';

const status = (q) => decideStatus(searchKnown(q)).status;

test('أقوال مشهورة خارج الكتب الستة والموطأ: الحكم منسوب إلى قائله', () => {
  assert.equal(status('اختلاف أمتي رحمة'), 'موضوع');
  assert.equal(status('صوموا تصحوا'), 'ضعيف');
  assert.equal(status('أنا مدينة العلم وعلي بابها'), 'موضوع');
  assert.ok(searchKnown('صوموا تصحوا').every((r) => r.muhaddith && r.source && r.number && r.ruling));
});

test('لا مطابقة لقول عادي أو لجزء صغير من قول مشهور', () => {
  assert.equal(searchKnown('الحمد لله رب العالمين').length, 0);
  assert.equal(searchKnown('رحمة').length, 0);
});

test('الاستخراج بالقواعد: حديث بين علامات تنصيص بعد نسبة', () => {
  const r = extractByRules('قال رسول الله ﷺ: «الدين النصيحة».');
  assert.equal(r.length, 1);
  assert.equal(r[0].quote, 'الدين النصيحة');
});

test('الاستخراج بالقواعد: حديث بلا علامات تنصيص بعد نسبة صريحة', () => {
  const t = 'قال رسول الله ﷺ إن الله جميل يحب الجمال، فاهتم بمظهرك.';
  const r = extractByRules(t);
  assert.equal(r.length, 1);
  assert.equal(r[0].quote, 'إن الله جميل يحب الجمال');
  assert.equal(t.slice(r[0].start, r[0].end), r[0].quote);
});

test('الاستخراج بالقواعد: لا يستخرج أقوال غير النبي ﷺ ولا النص العادي', () => {
  assert.equal(extractByRules('قال ابن القيم: «القلب يمرض كما يمرض البدن».').length, 0);
  assert.equal(extractByRules('قال الله تعالى: «فإن مع العسر يسرا».').length, 0);
  assert.equal(extractByRules('طلب العلم من أعظم القربات.').length, 0);
  assert.equal(extractByRules('قال النبي ﷺ لأصحابه').length, 0);
});

test('الاستخراج بالقواعد: نص مشكول، والحديث بين قوسين في سطر بعد «قال …:»', () => {
  const t = 'قَالَ رَسُولُ اللَّهِ صَلَّى اللَّهُ عَلَيْهِ وَسَلَّمَ:\n(مَنْ قَالَ حِينَ يَسْمَعُ النِّدَاءَ: اللَّهُمَّ رَبَّ هَذِهِ الدَّعْوَةِ التَّامَّةِ)\n«صحيح البخاري» (614)';
  const r = extractByRules(t);
  assert.equal(r.length, 1);
  assert.ok(r[0].quote.startsWith('مَنْ قَالَ'));
  assert.equal(t.slice(r[0].start, r[0].end), r[0].quote);
});