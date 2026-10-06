// مصدر احتياطي: نصوص كتب السنة وأحكام العلماء من مجموعة بيانات مفتوحة
// (fawazahmed0/hadith-api، رخصة Unlicense) تُنزَّل من jsDelivr وتُحفظ محلياً.
// يُستخدم فقط إذا تعذّر الوصول إلى الموسوعة الحديثية في الدرر.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { words } from './normalize.js';
import { similarity, snippet, MATCH_THRESHOLD, tokenize } from './match.js';
import { WIDESPREAD, SOURCE as WS_SOURCE, BY as WS_BY } from './widespread.js';
import { KNOWN } from './known.js';

const CDN = 'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions';
const DIR = fileURLToPath(new URL('../data/cache/', import.meta.url));

export const BOOKS = {
  bukhari: 'صحيح البخاري',
  muslim: 'صحيح مسلم',
  abudawud: 'سنن أبي داود',
  tirmidhi: 'جامع الترمذي',
  nasai: 'سنن النسائي',
  ibnmajah: 'سنن ابن ماجه',
  malik: 'موطأ مالك',
  nawawi: 'الأربعون النووية',
  qudsi: 'الأحاديث القدسية',
};
const SAHIHAYN = { bukhari: 'البخاري', muslim: 'مسلم' };

const GRADERS = {
  'al-albani': 'الألباني',
  'shuaib al arnaut': 'شعيب الأرناؤوط',
  'zubair ali zai': 'زبير علي زئي',
  'muhammad muhyi al-din abdul hamid': 'محمد محيي الدين عبد الحميد',
  'ahmad muhammad shakir': 'أحمد شاكر',
  'darussalam': 'دار السلام',
  'abu ghuddah': 'عبد الفتاح أبو غدة',
  'muhammad fouad abd al-baqi': 'محمد فؤاد عبد الباقي',
  'bashar awad maarouf': 'بشار عواد معروف',
  'salim al-hilali': 'سليم الهلالي',
};

// ترجمة عبارات الحكم الإنجليزية إلى العربية (الكلمات الطويلة أولاً)
const TERMS = [
  [/\s*-\s*agreed upon/gi, '، متفق عليه'], [/\s*-\s*bukhari and muslim/gi, '، رواه البخاري ومسلم'],
  [/sahih bukhari/gi, 'صحيح، رواه البخاري'], [/sahih muslim/gi, 'صحيح، رواه مسلم'],
  [/\s*hadith$/gi, ''], [/mutawatir/gi, 'متواتر'], [/muquf/gi, 'موقوف'],
  [/isnaad|isnad|sanad/gi, 'إسناده'], [/lighairihi|li ghairihi|lighayrihi/gi, 'لغيره'],
  [/da'?if jiddan|daif jiddan|very weak|very da'?if/gi, 'ضعيف جداً'], [/maudu'?|mawdu'?|fabricated/gi, 'موضوع'],
  [/munkar/gi, 'منكر'], [/shadh/gi, 'شاذ'], [/da'?if|daeef|daif|weak/gi, 'ضعيف'],
  [/sahih|saheeh|authentic/gi, 'صحيح'], [/hasan|good/gi, 'حسن'], [/mursal/gi, 'مرسل'],
  [/mauquf|mawquf/gi, 'موقوف'], [/maqtu'?/gi, 'مقطوع'], [/jayyid/gi, 'جيد'],
];
export function gradeToArabic(g = '') {
  let s = String(g);
  for (const [re, ar] of TERMS) s = s.replace(re, ar);
  return s.replace(/\s+/g, ' ').trim();
}
const graderName = (n = '') => GRADERS[n.toLowerCase().trim()] || n;

let db = null;       // [{ book, number, text }]
let index = null;    // Map(word -> Set(ids))
let loading = null;
export const status = { ready: false, count: 0, error: null };

async function loadBook(key, fetchImpl) {
  const file = `${DIR}ara-${key}.json`;
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  const res = await fetchImpl(`${CDN}/ara-${key}.json`);
  if (!res.ok) throw new Error(`download ${key} HTTP ${res.status}`);
  const data = await res.json();
  await mkdir(DIR, { recursive: true });
  await writeFile(file, JSON.stringify(data));
  return data;
}

export function load({ fetchImpl = globalThis.fetch } = {}) {
  if (loading) return loading;
  loading = (async () => {
    const all = [];
    for (const key of Object.keys(BOOKS)) {
      const data = await loadBook(key, fetchImpl);
      for (const h of data.hadiths || []) {
        if (!h.text || h.text.length < 10) continue;
        all.push({ book: key, number: h.hadithnumber, text: h.text, grades: h.grades || [] });
      }
    }
    const idx = new Map();
    all.forEach((h, id) => {
      for (const w of new Set(words(h.text))) {
        if (w.length < 3) continue;
        if (!idx.has(w)) idx.set(w, []);
        idx.get(w).push(id);
      }
    });
    db = all; index = idx;
    status.ready = true; status.count = all.length;
    console.log(`Local hadith data ready: ${all.length} hadiths`);
  })().catch((e) => { status.error = e.message; loading = null; throw e; });
  return loading;
}

// متن الحديث: في هذه المجموعة يقع كلام النبي ﷺ بين علامتي تنصيص بعد الإسناد.
// يُختار المقطع المقتبس الأقرب إلى نص البحث، فيُعرض ويُستبدل بلفظه دون الإسناد.
function matnFor(query, text) {
  const parts = text.split('"').map((p) => p.replace(/[\u200f\u200e]/g, '').trim());
  let best = null;
  for (let i = 1; i < parts.length; i += 2) {
    const seg = parts[i].replace(/^[.،,\s]+|[.،,\s]+$/g, '');
    if (seg.split(/\s+/).length < 2) continue;
    const sc = similarity(query, seg).score;
    if (!best || sc > best.sc) best = { seg, sc };
  }
  if (!best || best.sc < MATCH_THRESHOLD) return null;
  if (best.seg.split(/\s+/).length <= 45) return { text: best.seg, truncated: false };
  return snippet(query, best.seg);
}

// الأقوال المنتشرة التي لا تصح: تُطابق بصرامة أكبر (تشابه 0.8، وطول متقارب) لأنها قصيرة.
export function searchWidespread(query) {
  const qn = tokenize(query).tokens.length;
  return WIDESPREAD
    .map(([text, ruling, source]) => ({ text, ruling, source, s: similarity(query, text).score, n: tokenize(text).tokens.length }))
    .filter((x) => x.s >= 0.8 && x.n >= Math.ceil(qn * 0.5))
    .sort((a, b) => b.s - a.s)
    .slice(0, 2)
    .map(({ text, ruling, source }) => ({ text, truncated: false, rawi: '', muhaddith: WS_BY, source: source || WS_SOURCE, number: '', ruling, origin: 'widespread' }))
    .concat(searchKnown(query));
}

// أقوال مشهورة خارج الكتب التسعة: نتيجة لكل حكم، منسوبة إلى قائله وكتابه.
export function searchKnown(query) {
  const qn = tokenize(query).tokens.length;
  return KNOWN
    .filter((k) => similarity(query, k.text).score >= 0.8 && tokenize(k.text).tokens.length >= Math.ceil(qn * 0.5))
    .flatMap((k) => k.rulings.map(([muhaddith, source, number, ruling]) => ({ text: k.text, truncated: false, rawi: '', muhaddith, source, number, ruling, origin: 'known' })));
}

// يعيد نتائج بنفس شكل نتائج الدرر: نتيجة لكل حكم.
export async function searchLocal(query, limit = 6) {
  const widespread = searchWidespread(query);
  await load();
  const q = words(query).filter((w) => w.length >= 3);
  if (!q.length) return widespread;
  const counts = new Map();
  for (const w of new Set(q)) {
    const ids = index.get(w);
    if (!ids || ids.length > 6000) continue; // كلمات شائعة جداً لا تميّز
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
  }
  const candidates = [...counts.entries()]
    .filter(([, c]) => c >= Math.min(2, q.length))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 80)
    .map(([id]) => ({ h: db[id], s: similarity(query, db[id].text).score }))
    .filter((x) => x.s >= MATCH_THRESHOLD)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit);

  const out = [];
  for (const { h } of candidates) {
    const snip = matnFor(query, h.text) || snippet(query, h.text);
    const base = { text: snip.text, truncated: snip.truncated, rawi: '', source: BOOKS[h.book], number: String(h.number), origin: 'local' };
    if (SAHIHAYN[h.book]) {
      out.push({ ...base, muhaddith: SAHIHAYN[h.book], ruling: `أخرجه ${SAHIHAYN[h.book]} في صحيحه` });
    } else if (h.grades.length) {
      for (const g of h.grades) out.push({ ...base, muhaddith: graderName(g.name), ruling: gradeToArabic(g.grade) });
    } else {
      out.push({ ...base, muhaddith: '', ruling: '' });
    }
  }
  return [...widespread, ...out];
}

// للاختبار فقط
export function _setData(list) {
  db = list;
  index = new Map();
  list.forEach((h, id) => { for (const w of new Set(words(h.text))) { if (!index.has(w)) index.set(w, []); index.get(w).push(id); } });
  loading = Promise.resolve();
  status.ready = true; status.count = list.length;
}
