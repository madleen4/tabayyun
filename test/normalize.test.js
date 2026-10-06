import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeArabic } from '../src/normalize.js';

test('يحذف التشكيل والتطويل', () => {
  assert.equal(normalizeArabic('إنَّمَا الأعمـــالُ'), 'انما الاعمال');
});

test('يوحّد الألف والياء والتاء المربوطة', () => {
  assert.equal(normalizeArabic('أإآ على صلاة'), 'ااا علي صلاه');
});

test('يحذف علامات الترقيم والأقواس', () => {
  assert.equal(normalizeArabic('«الدِّينُ النَّصيحةُ»، رواه مسلم.'), 'الدين النصيحه رواه مسلم');
});

test('النيات والنوايا تبقيان مختلفتين بعد التطبيع (لازم لكشف التحريف)', () => {
  assert.notEqual(normalizeArabic('بالنيات'), normalizeArabic('بالنوايا'));
});
