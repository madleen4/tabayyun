// تطبيع النص العربي للمقارنة والبحث فقط.
// لا يُستخدم أبداً لعرض لفظ الحديث؛ اللفظ يُعرض كما ورد في المصدر.

const TASHKEEL = /[ؐ-ًؚ-ٰٟۖ-ۭ]/g; // الحركات وعلامات القرآن
const TATWEEL = /ـ/g; // ـ
const PUNCT = /[^\p{L}\p{N}\s]/gu; // كل ما ليس حرفاً أو رقماً أو مسافة

export function normalizeArabic(text = '') {
  return String(text)
    .replace(TASHKEEL, '')
    .replace(TATWEEL, '')
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(PUNCT, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// كلمات النص بعد التطبيع.
export function words(text = '') {
  const n = normalizeArabic(text);
  return n ? n.split(' ') : [];
}

// تطبيع حرفاً بحرف مع خريطة تعيد كل موضع إلى موضعه في النص الأصلي.
// يحذف التشكيل والتطويل ويوحّد الحروف، ولا يغيّر المسافات أو الترقيم.
const SINGLE = { 'إ': 'ا', 'أ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي', 'ة': 'ه', 'ؤ': 'و', 'ئ': 'ي' };
const DROP = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/;

export function normalizeWithMap(text = '') {
  let out = '';
  const map = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (DROP.test(ch)) continue;
    out += SINGLE[ch] || ch;
    map.push(i);
  }
  return { text: out, map };
}

// يبحث عن مقطع داخل النص متجاهلاً التشكيل، ويعيد موضعه في النص الأصلي.
export function locate(haystack, needle, fromIndex = 0) {
  const exact = haystack.indexOf(needle, fromIndex);
  if (exact !== -1) return { start: exact, end: exact + needle.length };
  const H = normalizeWithMap(haystack);
  const N = normalizeWithMap(needle).text.trim();
  if (!N) return null;
  let from = 0;
  while (from < H.map.length && H.map[from] < fromIndex) from++;
  const at = H.text.indexOf(N, from);
  if (at === -1) return null;
  const start = H.map[at];
  const end = H.map[at + N.length - 1] + 1;
  return { start, end };
}
