// موسوعة الأحاديث النبوية HadeethEnc.
// تُستخدم للأحاديث الثابتة والمطابقة والبدائل، كما في خطة تبيَّن الأصلية.
// المصدر الرسمي: https://hadeethenc.com/api-docs/

const BASE = 'https://hadeethenc.com/api/v1';
const SOURCE = 'موسوعة الأحاديث النبوية (HadeethEnc)';

function withTimeout(timeoutMs = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return { ctrl, done: () => clearTimeout(timer) };
}

async function getJson(url, { fetchImpl = globalThis.fetch, timeoutMs = 9000 } = {}) {
  const { ctrl, done } = withTimeout(timeoutMs);
  try {
    const headers = typeof window === 'undefined'
      ? { Accept: 'application/json', 'User-Agent': 'Tabayyun/1.0 (+https://tabayyun-oats.onrender.com)' }
      : { Accept: 'application/json' };
    const res = await fetchImpl(url, { signal: ctrl.signal, headers });
    if (!res.ok) throw new Error(`HadeethEnc HTTP ${res.status}`);
    return await res.json();
  } finally {
    done();
  }
}

function listFromSearch(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function normalizeDetail(d = {}) {
  const id = String(d.id || '').trim();
  // في HadeethEnc يكون title عادةً متن الحديث المختصر كما يظهر للمستخدم، وهو الأنسب للمطابقة اللفظية.
  const text = String(d.title || d.hadeeth || d.hadith_text || '').trim();
  const grade = String(d.grade || '').trim();
  const attribution = String(d.attribution || '').trim();
  // الموسوعة مخصّصة للأحاديث الصحيحة/الثابتة؛ إن غاب حقل الدرجة نبقي الحكم "ثابت"
  // ولا ننسبه إلى محدّث بعينه.
  const ruling = grade || 'ثابت';
  return {
    text,
    truncated: false,
    rawi: '',
    muhaddith: '',
    source: SOURCE,
    number: id,
    ruling: attribution ? `${ruling} — ${attribution}` : ruling,
    origin: 'hadeethenc',
    url: id ? `https://hadeethenc.com/ar/browse/hadith/${encodeURIComponent(id)}` : 'https://hadeethenc.com/ar/',
  };
}

export function hadeethEncSearchUrl(query) {
  return `${BASE}/hadeeths/search/?phrase=${encodeURIComponent(query)}&language=ar`;
}

export async function searchHadeethEnc(query, { fetchImpl = globalThis.fetch, timeoutMs = 9000, limit = 8 } = {}) {
  const q = String(query || '').trim();
  if (!q) return [];

  const searchData = await getJson(hadeethEncSearchUrl(q), { fetchImpl, timeoutMs });
  const cards = listFromSearch(searchData)
    .filter((x) => x && (x.id || x.hadeeth || x.hadith_text || x.title))
    .slice(0, limit);
  if (!cards.length) return [];

  const ids = [...new Set(cards.map((x) => String(x.id || '').trim()).filter(Boolean))];
  if (!ids.length) return cards.map(normalizeDetail).filter((x) => x.text);

  // الأسرع: جلب التفاصيل دفعة واحدة. وإذا تغيّر هذا المسار أو تعذّر، نرجع للمسار الفردي.
  try {
    const url = `${BASE}/hadeeths/multiple/?language=ar&ids=${encodeURIComponent(ids.join(','))}`;
    const many = await getJson(url, { fetchImpl, timeoutMs });
    const arr = Array.isArray(many) ? many : (Array.isArray(many?.data) ? many.data : []);
    if (arr.length) return arr.map(normalizeDetail).filter((x) => x.text);
  } catch {
    // fallback below
  }

  const out = [];
  for (const id of ids) {
    try {
      const url = `${BASE}/hadeeths/one/?language=ar&id=${encodeURIComponent(id)}`;
      const d = await getJson(url, { fetchImpl, timeoutMs });
      const n = normalizeDetail(d);
      if (n.text) out.push(n);
    } catch {
      // نتجاوز الحديث الذي تعذّر جلب تفاصيله فقط
    }
  }
  return out;
}