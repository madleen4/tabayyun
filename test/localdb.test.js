import test from 'node:test';
import assert from 'node:assert/strict';
import { _setData, searchLocal, gradeToArabic } from '../src/localdb.js';
import { decideStatus } from '../src/classify.js';

_setData([
  { book: 'bukhari', number: 1, text: 'حدثنا الحميدي قال حدثنا سفيان عن عمر بن الخطاب قال سمعت رسول الله صلى الله عليه وسلم يقول إنما الأعمال بالنيات وإنما لكل امرئ ما نوى', grades: [] },
  { book: 'ibnmajah', number: 224, text: 'حدثنا هشام عن أنس بن مالك قال قال رسول الله صلى الله عليه وسلم طلب العلم فريضة على كل مسلم', grades: [{ name: 'Al-Albani', grade: 'Sahih' }, { name: 'Darussalam', grade: "Da'if" }] },
  { book: 'tirmidhi', number: 1, text: 'حديث آخر لا علاقة له بالموضوع', grades: [] },
]);

test('ترجمة الأحكام', () => {
  assert.equal(gradeToArabic('Hasan Sahih'), 'حسن صحيح');
  assert.equal(gradeToArabic("Da'if Jiddan"), 'ضعيف جداً');
  assert.equal(gradeToArabic('Isnaad Hasan'), 'إسناده حسن');
  assert.equal(gradeToArabic('Sahih Lighairihi'), 'صحيح لغيره');
  assert.equal(gradeToArabic('Maudu'), 'موضوع');
});

test('حديث في البخاري = ثابت', async () => {
  const r = await searchLocal('إنما الأعمال بالنيات');
  assert.equal(r.length, 1);
  assert.equal(r[0].source, 'صحيح البخاري');
  assert.equal(decideStatus(r).status, 'ثابت');
  assert.ok(r[0].text.includes('إنما الأعمال بالنيات'));
});

test('أحكام متعارضة = مختلف فيه', async () => {
  const r = await searchLocal('طلب العلم فريضة على كل مسلم');
  assert.equal(r.length, 2);
  assert.deepEqual(r.map((x) => x.muhaddith), ['الألباني', 'دار السلام']);
  assert.equal(decideStatus(r).status, 'مختلف فيه');
});

test('لا نتيجة لنص غير موجود', async () => {
  assert.equal((await searchLocal('كتب الحاسوب سريعة جدا اليوم')).length, 0);
});

test('القول المنتشر الذي لا يصح يأتي بدرجته من القائمة', async () => {
  const r = await searchLocal('اطلبوا العلم ولو بالصين');
  assert.equal(r[0].origin, 'widespread');
});