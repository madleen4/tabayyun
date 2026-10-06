// استخراج احتياطي بقواعد ثابتة، يُستخدم إذا لم يتوفر مفتاح النموذج أو تعطّل.
// يلتقط النص بين علامات التنصيص أو الأقواس إذا سبقته عبارة نسبة إلى النبي ﷺ.
// يعمل على نسخة بلا تشكيل (حتى تُلتقط «قَالَ رَسُولُ اللَّهِ»)، ثم تُعاد المواضع إلى النص الأصلي.

const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/;
const ATTR = /(قال رسول الله|قال النبي|رسول الله ﷺ|رسول الله صلى الله عليه وسلم|النبي ﷺ|النبي صلى الله عليه وسلم|عن النبي|يقول ﷺ|قال ﷺ|ﷺ|صلى الله عليه وسلم)/;
const QUOTED = /«([^»]{2,1200})»|“([^”]{2,1200})”|"([^"]{2,1200})"|\(([^()]{2,1200})\)/g;
const UNQUOTED = /(?:قال|يقول)\s+(?:رسول الله|النبي)\s*(?:ﷺ|صلى الله عليه وسلم)\s*:?[ \t]*(?![«“"(])([^«»“”"()\n،,.؛!؟?:]{6,300})/g;

// نسخة بلا تشكيل مع موضع كل حرف منها في الأصل
function strip(text) {
  let out = '';
  const map = [];
  for (let i = 0; i < text.length; i++) {
    if (TASHKEEL.test(text[i])) continue;
    out += text[i];
    map.push(i);
  }
  map.push(text.length);
  return { out, map };
}

export function extractByRules(text = '') {
  const { out: s, map } = strip(text);
  const toItem = (a, b) => {
    const start = map[a];
    const end = b < map.length - 1 ? map[b - 1] + 1 : text.length;
    // حركات الحرف الأخير جزء منه
    let e = end;
    while (e < text.length && TASHKEEL.test(text[e])) e++;
    const raw = text.slice(start, e);
    const lead = raw.length - raw.trimStart().length;
    const quote = raw.trim();
    return { quote, kind: 'hadith', start: start + lead, end: start + lead + quote.length };
  };
  const items = [];
  let m;
  let prevEnd = 0;
  QUOTED.lastIndex = 0;
  while ((m = QUOTED.exec(s))) {
    const inner = m[1] || m[2] || m[3] || m[4];
    const innerStart = m.index + 1;
    // النسبة في الجملة نفسها قبل علامة التنصيص، أو في السطر السابق إذا انتهى بنقطتين (قال …:\n«…»)
    const window = s.slice(Math.max(prevEnd, m.index - 120), m.index);
    let before = window.split(/[.!؟?\n]/).pop();
    if (!before.trim() && /:\s*$/.test(window)) before = window.replace(/\s+$/, '').split(/[.!؟?\n]/).pop();
    prevEnd = m.index + m[0].length;
    if (ATTR.test(before) || /^\s*[،,]?\s*وقال\s*:?\s*$/.test(before) && items.length) {
      if (inner.trim().length >= 2) items.push(toItem(innerStart, innerStart + inner.length));
    }
  }
  // حديث بلا علامات تنصيص بعد نسبة صريحة: «قال رسول الله ﷺ إن الله جميل يحب الجمال، …»
  // يؤخذ الكلام حتى أول فاصلة أو نقطة، بشرط ثلاث كلمات على الأقل.
  UNQUOTED.lastIndex = 0;
  while ((m = UNQUOTED.exec(s))) {
    const q = m[1];
    const a = m.index + m[0].length - q.length;
    const it = toItem(a, a + q.length);
    if (it.quote.split(/\s+/).length < 3) continue;
    if (items.some((x) => it.start < x.end + 2 && it.end > x.start - 2)) continue;
    items.push(it);
  }
  return items.sort((a, b) => a.start - b.start);
}
