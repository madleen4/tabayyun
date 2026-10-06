import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRuling, decideStatus } from '../src/classify.js';

const c = (r, s = '') => classifyRuling(r, s);

test('أحكام الثبوت', () => {
  assert.deepEqual(c('صحيح'), { cat: 'ثابت', level: 'matn' });
  assert.equal(c('حسن صحيح').cat, 'ثابت');
  assert.equal(c('صحيح لغيره').cat, 'ثابت');
  assert.deepEqual(c('إسناده صحيح'), { cat: 'ثابت', level: 'isnad' });
  assert.equal(c('', 'صحيح البخاري').cat, 'ثابت');
});

test('أحكام الضعف', () => {
  assert.deepEqual(c('ضعيف'), { cat: 'ضعيف', level: 'matn' });
  assert.equal(c('ضعيف جداً').cat, 'ضعيف');
  assert.deepEqual(c('مرسل'), { cat: 'ضعيف', level: 'isnad' });
  assert.deepEqual(c('[فيه] عبد الله بن شبيب واه'), { cat: 'ضعيف', level: 'isnad' });
  assert.equal(c('مختلف فيه وليس بالقوي').cat, 'ضعيف');
  assert.equal(c('لا يصح').cat, 'ضعيف');
  assert.equal(c('ليس بصحيح').cat, 'ضعيف', 'النفي يسبق كلمة صحيح');
  assert.deepEqual(c('خطأ [يعني في إسناده] لا شك فيه'), { cat: 'ضعيف', level: 'isnad' });
});

test('أحكام الوضع', () => {
  assert.equal(c('موضوع').cat, 'موضوع');
  assert.equal(c('باطل لا أصل له').cat, 'موضوع');
  assert.equal(c('لا أصل له').cat, 'موضوع');
  assert.equal(c('فيه الحكم بن عبد الله الأيلي قال الذهبي: متروك متهم بالوضع').cat, 'ضعيف', 'اتهام راوٍ ليس حكماً بوضع المتن');
});

test('عبارة لا تكفي للحكم', () => {
  assert.equal(c('أورده في كتابه').cat, null);
});

test('الحالة: ثابت فقط', () => {
  assert.equal(decideStatus([{ ruling: 'صحيح' }, { ruling: 'حسن' }]).status, 'ثابت');
});

test('الحالة: ثابت مع تضعيف بعض الأسانيد يبقى ثابتاً', () => {
  const d = decideStatus([{ ruling: 'صحيح' }, { ruling: 'إسناده ضعيف' }]);
  assert.equal(d.status, 'ثابت');
  assert.ok(d.note);
});

test('الحالة: تعارض بين التصحيح والتضعيف = مختلف فيه', () => {
  assert.equal(decideStatus([{ ruling: 'صحيح' }, { ruling: 'موضوع' }]).status, 'مختلف فيه');
});

test('الحالة: موضوع وضعيف', () => {
  assert.equal(decideStatus([{ ruling: 'موضوع' }, { ruling: 'باطل' }, { ruling: 'ضعيف' }]).status, 'موضوع');
  assert.equal(decideStatus([{ ruling: 'ضعيف' }, { ruling: 'ضعيف جدا' }, { ruling: 'موضوع' }]).status, 'ضعيف');
});

test('الحالة: لا أحكام صريحة = لم يُعثر عليه', () => {
  assert.equal(decideStatus([{ ruling: '' }]).status, 'لم يُعثر عليه');
  assert.equal(decideStatus([]).status, 'لم يُعثر عليه');
});
