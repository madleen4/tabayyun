// حماية ألفاظ الأحاديث عند تعديل الصياغة:
// يُستبدل كل حديث برمز ⟦n⟧ قبل إرسال النص للنموذج، ثم يُعاد اللفظ حرفياً بعد التحقق.

export function protect(text, spans) {
  // spans: [{ start, end }] مرتبة أو غير مرتبة
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let out = '';
  let last = 0;
  const map = {};
  sorted.forEach((s, i) => {
    const key = `⟦${i + 1}⟧`;
    out += text.slice(last, s.start) + key;
    map[key] = text.slice(s.start, s.end);
    last = s.end;
  });
  out += text.slice(last);
  return { masked: out, map };
}

const ATTRIBUTION = /(رسول الله|النبي|ﷺ|صلى الله عليه وسلم|قال الله)/g;
const count = (s, re) => (s.match(re) || []).length;

// يتحقق من ناتج النموذج ثم يعيد الألفاظ. يرمي خطأ بالسبب إن رُفض الناتج.
export function restore(original, masked, output, map) {
  const keys = Object.keys(map);
  for (const k of keys) {
    const n = output.split(k).length - 1;
    if (n !== 1) throw new Error(`الرمز ${k} ظهر ${n} مرة بدل مرة واحدة`);
  }
  const extra = (output.match(/⟦\d+⟧/g) || []).filter((k) => !keys.includes(k));
  if (extra.length) throw new Error('ظهرت رموز غير موجودة في الأصل');
  const strip = (s) => keys.reduce((acc, k) => acc.split(k).join(''), s);
  if (count(strip(output), ATTRIBUTION) > count(strip(masked), ATTRIBUTION)) {
    throw new Error('أضاف النموذج نسبة جديدة إلى النبي ﷺ أو إلى القرآن');
  }
  if (/[«»"“”]/.test(strip(output)) && !/[«»"“”]/.test(strip(masked))) {
    throw new Error('أضاف النموذج نصاً بين علامات تنصيص');
  }
  const ratio = output.length / Math.max(1, masked.length);
  if (ratio < 0.5 || ratio > 1.8) throw new Error('تغيّر طول النص كثيراً');
  let result = output;
  for (const k of keys) result = result.split(k).join(map[k]);
  return result;
}
