// تحويل عبارة حكم المحدِّث إلى إحدى الفئات، ثم تحديد الحالة من مجموع الأحكام.
// قواعد ثابتة مكتوبة (لا ذكاء اصطناعي)، ويراجعها المرشد الشرعي. انظر docs/rulings-table.md
import { normalizeArabic } from './normalize.js';

export const STATUSES = ['ثابت', 'ضعيف', 'موضوع', 'مختلف فيه', 'لم يُعثر عليه'];

const has = (t, list) => list.some((p) => (' ' + t + ' ').includes(' ' + p + ' ') || t.includes(p) && p.includes(' '));

const NEGATED_SOUND = ['ليس بصحيح', 'غير صحيح', 'ليس بثابت', 'لا يصح', 'لا يثبت', 'لم يصح', 'لم يثبت', 'لم تثبت', 'لا تثبت'];
const ACCUSED = ['متهم بالوضع', 'يضع الحديث', 'وضاع', 'كذاب'];
const FABRICATED = ['موضوع', 'مكذوب', 'كذب', 'باطل', 'لا اصل له', 'ليس له اصل', 'لا اصل', 'مختلق', 'موضوعه', 'ليس بحديث', 'ليس له وجود'];
const WEAK = ['ضعيف', 'ضعيفه', 'ضعفه', 'منكر', 'واه', 'متروك', 'مرسل', 'منقطع', 'معضل', 'شاذ', 'خطا', 'معلول', 'مضطرب', 'لا يعرف', 'ضعيف جدا', 'ليس بالقوي', 'ليس بقوي', 'لين', 'فيه ضعف', 'فيه نظر'];
const SOUND = ['صحيح', 'حسن', 'ثابت', 'صححه', 'حسنه', 'جيد', 'اسناده جيد', 'رجاله ثقات', 'متفق عليه', 'صحيح لغيره', 'حسن لغيره'];
const ISNAD = ['اسناده', 'اسناد', 'رجاله', 'مرسل', 'منقطع', 'فيه', 'متروك', 'متهم', 'طريق', 'سنده', 'راويه'];

// يعيد { cat: 'ثابت' | 'ضعيف' | 'موضوع' | null, level: 'matn' | 'isnad' }
export function classifyRuling(ruling = '', source = '') {
  const t = normalizeArabic(ruling);
  const level = ISNAD.some((w) => (' ' + t + ' ').includes(' ' + w + ' ') || t.startsWith(w)) ? 'isnad' : 'matn';
  if (!t) {
    const s = normalizeArabic(source);
    if (s.includes('صحيح البخاري') || s.includes('صحيح مسلم')) return { cat: 'ثابت', level: 'matn' };
    return { cat: null, level };
  }
  if (has(t, NEGATED_SOUND)) return { cat: 'ضعيف', level };
  if (has(t, ACCUSED)) return { cat: 'ضعيف', level: 'isnad' };
  if (has(t, FABRICATED)) return { cat: 'موضوع', level };
  if (has(t, WEAK)) return { cat: 'ضعيف', level };
  if (has(t, SOUND)) return { cat: 'ثابت', level };
  const s = normalizeArabic(source);
  if (s.includes('صحيح البخاري') || s.includes('صحيح مسلم')) return { cat: 'ثابت', level: 'matn' };
  return { cat: null, level };
}

// يحدد حالة الحديث من أحكام النتائج المطابقة له.
// matched: [{ ruling, source, muhaddith, ... }]
export function decideStatus(matched = []) {
  const judged = matched.map((m) => ({ ...m, ...classifyRuling(m.ruling, m.source) }));
  const withCat = judged.filter((j) => j.cat);
  if (!withCat.length) {
    return { status: 'لم يُعثر عليه', note: 'وُجدت نصوص مشابهة دون حكم صريح يكفي للحكم.', judged };
  }
  const pos = withCat.filter((j) => j.cat === 'ثابت');
  const fab = withCat.filter((j) => j.cat === 'موضوع');
  const weak = withCat.filter((j) => j.cat === 'ضعيف');
  const negMatn = [...fab, ...weak].filter((j) => j.level === 'matn');

  // ما أخرجه البخاري أو مسلم في صحيحه ثابت، ولو ضُعّف من طرق أخرى
  const inSahihayn = pos.some((j) => /صحيح البخاري|صحيح مسلم/.test(normalizeArabic(j.source || '')));
  if (inSahihayn && negMatn.length) {
    return { status: 'ثابت', note: 'أخرجه أحد الصحيحين، وضُعّفت بعض طرقه الأخرى، والأحكام كلها معروضة.', judged };
  }
  if (pos.length && negMatn.length) {
    return { status: 'مختلف فيه', note: 'تعارضت أحكام المحدِّثين على الحديث، فتُعرض كلها دون ترجيح.', judged };
  }
  if (pos.length) {
    const note = fab.length || weak.length ? 'بعض أسانيده ضُعّفت، والحديث ثابت من طرق أخرى بحسب الأحكام المعروضة.' : '';
    return { status: 'ثابت', note, judged };
  }
  if (fab.length && fab.length >= weak.length) {
    const note = weak.length ? 'ومن المحدِّثين من اكتفى بتضعيفه.' : '';
    return { status: 'موضوع', note, judged };
  }
  const note = fab.length ? 'ومن المحدِّثين من حكم بوضعه.' : '';
  return { status: 'ضعيف', note, judged };
}