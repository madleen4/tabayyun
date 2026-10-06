// عمليات النص: التصحيح، والحذف، والتوثيق، واقتطاع البدائل، وتحسين الصياغة.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hasArabic, trimQuotes, excerpt, citation, buildCorrected, splitForRephrase, applyRephrase } from '../src/text-ops.js';

const TEXT = 'طلب العلم من أعظم القربات، قال رسول الله ﷺ: «اطلبوا العلم ولو بالصين».\nوقال ﷺ: «الدين النصيحة»، فلنتناصح.';
const q1 = 'اطلبوا العلم ولو بالصين';
const q2 = 'الدين النصيحة';
const ITEMS = [
  { quote: q1, start: TEXT.indexOf(q1), end: TEXT.indexOf(q1) + q1.length, status: 'موضوع' },
  { quote: q2, start: TEXT.indexOf(q2), end: TEXT.indexOf(q2) + q2.length, status: 'ثابت', diff: { distorted: false, ref: { source: 'صحيح مسلم', number: '196', muhaddith: 'مسلم', ruling: 'أخرجه مسلم في صحيحه' } } },
];

test('النص العربي فقط يُعد نصاً قابلاً للفحص', () => {
  assert.equal(hasArabic('Big data is velocity'), false);
  assert.equal(hasArabic('الدين النصيحة'), true);
});

test('إزالة علامات التنصيص المكررة حول الحديث', () => {
  const t = trimQuotes({ quote: '«الدين النصيحة»', start: 10, end: 25 });
  assert.equal(t.quote, 'الدين النصيحة');
  assert.equal(t.start, 11);
  assert.equal(t.end, 24);
});

test('إبقاء النص كما هو لا يغيّره، ويذكر مصدر الحديث الثابت', () => {
  const r = buildCorrected(TEXT, ITEMS, [{ mode: 'keep' }, { mode: 'keep' }]);
  assert.equal(r.text, TEXT);
  assert.deepEqual(r.sources, ['«الدين النصيحة» أخرجه مسلم في صحيحه (196).']);
});

test('الحذف يزيل الحديث مع عبارة النسبة وعلامتي التنصيص', () => {
  const r = buildCorrected(TEXT, ITEMS, [{ mode: 'remove' }, { mode: 'keep' }]);
  assert.ok(r.text.startsWith('طلب العلم من أعظم القربات.'));
  assert.ok(!r.text.includes('الصين'));
  assert.ok(!r.text.includes('قال رسول الله'));
  assert.ok(r.text.includes('«الدين النصيحة»'));
});

test('الاستبدال ببديل ثابت يضعه مكان الحديث ويوثّقه', () => {
  const alt = { text: 'مَنْ سَلَكَ طَرِيقًا يَلْتَمِسُ فِيهِ عِلْمًا', source: 'صحيح مسلم', number: '2699', muhaddith: 'مسلم', ruling: 'أخرجه مسلم في صحيحه', partial: true };
  const r = buildCorrected(TEXT, ITEMS, [{ mode: 'alt', alt }, { mode: 'keep' }]);
  assert.ok(r.text.includes(`«${alt.text}»`));
  assert.ok(!r.text.includes('الصين'));
  assert.ok(r.sources[0].includes('(جزء من حديث)'));
  assert.ok(r.sources[0].includes('أخرجه مسلم في صحيحه (2699)'));
  assert.equal(r.touched.length, 1);
});

test('استبدال اللفظ المحرّف بلفظ المصدر', () => {
  const t = 'قال النبي ﷺ: «إنما الأعمال بالنوايا».';
  const q = 'إنما الأعمال بالنوايا';
  const it = { quote: q, start: t.indexOf(q), end: t.indexOf(q) + q.length, status: 'ثابت',
    diff: { distorted: true, sourceWindow: 'إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ', ref: { source: 'صحيح البخاري', number: '1', ruling: 'أخرجه البخاري في صحيحه' } } };
  const r = buildCorrected(t, [it], [{ mode: 'source' }]);
  assert.equal(r.text, 'قال النبي ﷺ: «إِنَّمَا الْأَعْمَالُ بِالنِّيَّاتِ».');
});

test('التوثيق: الصحيحان بصيغة «أخرجه»، وغيرهما بالمصدر وقول المحدِّث', () => {
  assert.equal(citation({ source: 'صحيح البخاري', number: '1', muhaddith: 'البخاري', ruling: 'أخرجه البخاري في صحيحه' }), 'أخرجه البخاري في صحيحه (1)');
  assert.equal(citation({ source: 'جامع الترمذي', number: '2646', muhaddith: 'الألباني', ruling: 'صحيح' }), 'جامع الترمذي (2646)، وقال الألباني: صحيح');
});

test('اقتطاع الموضع المطلوب من حديث طويل', () => {
  const long = 'مَنْ نَفَّسَ عَنْ مُؤْمِنٍ كُرْبَةً مِنْ كُرَبِ الدُّنْيَا نَفَّسَ اللَّهُ عَنْهُ كُرْبَةً مِنْ كُرَبِ يَوْمِ الْقِيَامَةِ وَمَنْ يَسَّرَ عَلَى مُعْسِرٍ يَسَّرَ اللَّهُ عَلَيْهِ فِي الدُّنْيَا وَالْآخِرَةِ وَمَنْ سَلَكَ طَرِيقًا يَلْتَمِسُ فِيهِ عِلْمًا سَهَّلَ اللَّهُ لَهُ بِهِ طَرِيقًا إِلَى الْجَنَّةِ وَمَا اجْتَمَعَ قَوْمٌ فِي بَيْتٍ مِنْ بُيُوتِ اللَّهِ';
  assert.equal(excerpt(long, 'من سلك طريقا يلتمس فيه علما'), 'مَنْ سَلَكَ طَرِيقًا يَلْتَمِسُ فِيهِ عِلْمًا سَهَّلَ اللَّهُ لَهُ بِهِ طَرِيقًا إِلَى الْجَنَّةِ');
});

// ---------- تحسين الصياغة ----------
const corrected = () => buildCorrected(TEXT, ITEMS, [{ mode: 'remove' }, { mode: 'keep' }]);

test('تحسين الصياغة يرسل الفقرة المعدّلة فقط، والأحاديث مفصولة عن الكلام', () => {
  const c = corrected();
  const plan = splitForRephrase(c.text, c.spans, c.touched);
  assert.equal(plan.items.length, 1);
  assert.deepEqual(plan.items[0], { parts: ['طلب العلم من أعظم القربات.'], quotes: [] });
});

test('تحسين الصياغة: فقرة فيها حديث تُقسم حوله، ولفظ الحديث لا يُرسل للتعديل', () => {
  const t = 'والنية أساس العمل، وقد قال النبي ﷺ: «إنما الأعمال بالنيات».';
  const s = t.indexOf('إنما');
  const plan = splitForRephrase(t, [{ start: s, end: s + 'إنما الأعمال بالنيات'.length }], [s]);
  assert.deepEqual(plan.items[0].quotes, ['إنما الأعمال بالنيات']);
  assert.deepEqual(plan.items[0].parts, ['والنية أساس العمل، وقد قال النبي ﷺ: «', '».']);
  const r = applyRephrase(plan, [{ parts: ['والنية أساس كل عمل، وقد قال النبي ﷺ: «', '».'] }]);
  assert.equal(r.changed, 1);
  assert.equal(r.text, 'والنية أساس كل عمل، وقد قال النبي ﷺ: «إنما الأعمال بالنيات».');
});

test('تحسين الصياغة يرفض أي نسبة جديدة إلى النبي ﷺ', () => {
  const c = corrected();
  const plan = splitForRephrase(c.text, c.spans, c.touched);
  const r = applyRephrase(plan, [{ parts: ['طلب العلم من أعظم القربات، وقال رسول الله ﷺ كذا.'] }]);
  assert.equal(r.changed, 0);
  assert.equal(r.rejected, 1);
  assert.equal(r.text, c.text);
});

test('تحسين الصياغة يرفض أي نص جديد بين علامات تنصيص', () => {
  const c = corrected();
  const plan = splitForRephrase(c.text, c.spans, c.touched);
  const r = applyRephrase(plan, [{ parts: ['طلب العلم من أعظم القربات، وفي الأثر «العلم نور».'] }]);
  assert.equal(r.rejected, 1);
});

test('تحسين الصياغة يرفض ناتجاً بعدد أجزاء مختلف', () => {
  const c = corrected();
  const plan = splitForRephrase(c.text, c.spans, c.touched);
  assert.equal(applyRephrase(plan, [{ parts: ['أ', 'ب'] }]).rejected, 1);
  assert.equal(applyRephrase(plan, [{}]).rejected, 1);
});

test('تحسين الصياغة يقبل الاقتراح السليم ويغيّر الفقرة المعدّلة وحدها', () => {
  const c = corrected();
  const plan = splitForRephrase(c.text, c.spans, c.touched);
  const r = applyRephrase(plan, [{ parts: ['طلب العلم من أعظم القربات، فاحرص عليه.'] }]);
  assert.equal(r.changed, 1);
  assert.equal(r.text.split('\n')[0], 'طلب العلم من أعظم القربات، فاحرص عليه.');
  assert.equal(r.text.split('\n')[1], c.text.split('\n')[1]);
});

// ---------- نص PDF العربي ----------
import { repairPdfArabic, looksGarbledPdf } from '../src/text-ops.js';

test('إصلاح حروف PDF المعكوسة الآمنة', () => {
  assert.equal(repairPdfArabic('ترجمة اإلمام البخاري'), 'ترجمة الإمام البخاري');
  assert.equal(repairPdfArabic('قال رسول الله ملسو هيلع هللا ىلص: «إنما األعمال»'), 'قال رسول الله ﷺ: «إنما الأعمال»');
  assert.equal(repairPdfArabic('رحمه اهلل تعالى'), 'رحمه الله تعالى');
  assert.equal(repairPdfArabic('إلى البصرة'), 'إلى البصرة'); // لا يُفسد الكلمات السليمة
});

test('كشف نص PDF المشوّه', () => {
  assert.equal(looksGarbledPdf('أشهرهم مسلم بن احلجاج، وقال حممد بن بشار: مل يكن يف البصرة رجل أعلم، رمحه اهلل يف علمه'), true);
  assert.equal(looksGarbledPdf('قال محمد بن بشار: لم يكن في البصرة أعلم منه، رحمه الله.'), false);
});

test('إصلاح كلمات شائعة منقلبة في PDF', () => {
  assert.equal(repairPdfArabic('احلمد لله، وأشهد أن حممد عبده، ونعوذ باالله، مل يكن يف البصرة'), 'الحمد لله، وأشهد أن محمد عبده، ونعوذ بالله، لم يكن في البصرة');
  assert.equal(repairPdfArabic('أصدق احلديث كتاب الله'), 'أصدق الحديث كتاب الله');
});

test('الحركات المنفصلة بمسافة تُعاد إلى حرفها', () => {
  assert.equal(repairPdfArabic('يا أيها ال ّذِين آمنوا'), 'يا أيها الّذِين آمنوا');
});

test('إصلاح الحروف المنقلبة مع التشكيل والأقواس المعكوسة', () => {
  assert.equal(repairPdfArabic('وَاحلِكْمَةَ السُّنَّةُ، وَقَدْ قَالَ النَّيب ﷺ'), 'وَالحِكْمَةَ السُّنَّةُ، وَقَدْ قَالَ النَّبي ﷺ');
  assert.equal(repairPdfArabic('قال ﷺ: )الدين النصيحة('), 'قال ﷺ: (الدين النصيحة)');
  assert.equal(repairPdfArabic('قال (الدين النصيحة) لهم'), 'قال (الدين النصيحة) لهم');
  assert.equal(looksGarbledPdf('وَاحلِكْمَةَ وَقَالَ النَّيب يف ذلك'), true);
});

import { orderPdfItems } from '../src/text-ops.js';
test('ترتيب مقاطع PDF: السطر العربي من اليمين إلى اليسار، والأسطر من الأعلى', () => {
  const items = [
    { str: ': «الدين النصيحة».', x: 100, y: 700 },
    { str: 'قال رسول الله', x: 400, y: 700 },
    { str: 'ﷺ', x: 300, y: 700 },
    { str: 'منشور', x: 450, y: 740 },
  ];
  assert.equal(orderPdfItems(items), 'منشور\nقال رسول الله ﷺ : «الدين النصيحة».');
});

test('الحديث أطول في المصدر: يُعرض كاملاً ويُتاح الاستبدال به', async () => {
  const { fullSource } = await import('../src/text-ops.js');
  const ref = { text: 'طلب العلم فريضة على كل مسلم وواضع العلم عند غير أهله كمقلد الخنازير الجوهر واللؤلؤ والذهب', source: 'سنن ابن ماجه', number: '224', muhaddith: 'الألباني', ruling: 'ضعيف جدا' };
  assert.equal(fullSource('طلب العلم فريضة على كل مسلم', ref), ref);
  assert.equal(fullSource('صوموا تصحوا', { text: 'صوموا تصحوا' }), null);
  assert.equal(fullSource('صوموا تصحوا', null), null);
  const text = 'قال ﷺ: «طلب العلم فريضة على كل مسلم».';
  const start = text.indexOf('طلب');
  const it = { quote: 'طلب العلم فريضة على كل مسلم', start, end: start + 27, status: 'ضعيف', full: ref };
  const out = buildCorrected(text, [it], [{ mode: 'full' }]);
  assert.ok(out.text.includes('كمقلد الخنازير'));
  assert.ok(out.sources[0].includes('سنن ابن ماجه (224)'));
});