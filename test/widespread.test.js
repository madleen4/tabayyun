import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchWidespread } from '../src/localdb.js';
import { classifyRuling } from '../src/classify.js';
import { decideStatus } from '../src/classify.js';

test('widespread: famous fabricated sayings are found', () => {
  const r = searchWidespread('اطلبوا العلم ولو بالصين');
  assert.equal(r.length >= 1, true);
  assert.equal(r[0].ruling, 'باطل لا أصل له');
  assert.equal(decideStatus(r).status, 'موضوع');
  assert.equal(decideStatus(searchWidespread('حب الوطن من الإيمان')).status, 'موضوع');
});

test('widespread: authentic hadiths do not match', () => {
  assert.equal(searchWidespread('إنما الأعمال بالنيات').length, 0);
  assert.equal(searchWidespread('الدين النصيحة').length, 0);
  assert.equal(searchWidespread('من سلك طريقا يلتمس فيه علما سهل الله له به طريقا إلى الجنة').length, 0);
});

test('classify: "ليس بحديث" counts as fabricated', () => {
  assert.equal(classifyRuling('ليس بحديث').cat, 'موضوع');
  assert.equal(classifyRuling('لا يصح بهذا اللفظ').cat, 'ضعيف');
});

test('classify: hadith in a Sahih stays ثابت even if other routes were weakened', () => {
  const r = decideStatus([
    { source: 'صحيح مسلم', ruling: 'أخرجه مسلم في صحيحه' },
    { source: 'جامع الترمذي', ruling: 'ضعيف' },
  ]);
  assert.equal(r.status, 'ثابت');
});