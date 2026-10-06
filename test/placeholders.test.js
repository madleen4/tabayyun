import test from 'node:test';
import assert from 'node:assert/strict';
import { protect, restore } from '../src/placeholders.js';

const text = 'قال ﷺ: «الدين النصيحة» فلنتناصح. وقال: «إنما الأعمال بالنيات».';
const q1 = text.indexOf('الدين');
const q2 = text.indexOf('إنما');
const spans = [{ start: q1, end: q1 + 'الدين النصيحة'.length }, { start: q2, end: q2 + 'إنما الأعمال بالنيات'.length }];

test('إخفاء الأحاديث برموز', () => {
  const { masked, map } = protect(text, spans);
  assert.equal(masked, 'قال ﷺ: «⟦1⟧» فلنتناصح. وقال: «⟦2⟧».');
  assert.equal(map['⟦1⟧'], 'الدين النصيحة');
});

test('إعادة الألفاظ حرفياً بعد صياغة سليمة', () => {
  const { masked, map } = protect(text, spans);
  const out = 'قال ﷺ: «⟦1⟧»، فلنحرص على التناصح. وقال أيضاً: «⟦2⟧».';
  assert.equal(restore(text, masked, out, map), 'قال ﷺ: «الدين النصيحة»، فلنحرص على التناصح. وقال أيضاً: «إنما الأعمال بالنيات».');
});

test('رفض الناتج إذا حُذف رمز', () => {
  const { masked, map } = protect(text, spans);
  assert.throws(() => restore(text, masked, 'قال ﷺ: «⟦1⟧» فلنتناصح.', map), /⟦2⟧/);
});

test('رفض الناتج إذا تكرر رمز', () => {
  const { masked, map } = protect(text, spans);
  assert.throws(() => restore(text, masked, 'قال ﷺ: «⟦1⟧» «⟦1⟧» وقال: «⟦2⟧».', map));
});

test('رفض الناتج إذا أضاف نسبة جديدة إلى النبي ﷺ', () => {
  const { masked, map } = protect(text, spans);
  assert.throws(() => restore(text, masked, 'قال ﷺ: «⟦1⟧» وقال رسول الله ﷺ أيضاً كلاماً. وقال: «⟦2⟧».', map), /نسبة/);
});
