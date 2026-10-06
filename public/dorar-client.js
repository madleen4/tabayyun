// طبقة الوصول إلى محتوى الدرر السنية عبر API الباحث الحديثي.
// لا يوجد fallback إلى الكتب الستة أو مصدر حديثي آخر.

const SEARCH_ENDPOINT = 'https://search.sunnah.one/';
const REQUEST_TIMEOUT = 15000;

function clean(value) {
  return String(value ?? '')
    .replace(/<mark[^>]*>/gi, '')
    .replace(/<\/mark>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeResult(item = {}) {
  const text = clean(item.text);
  const ruling = clean(item.hukm);
  const takhreej = clean(item.takhreej);
  const sourceLocation = clean(item.source_location);

  return {
    text,
    truncated: false,
    rawi: clean(item.rawy),
    muhaddith: clean(item.muhaddith),
    // الـ API يعيد معرّفات رقمية لبعض الحقول؛ التخريج نص مقروء وأوثق للعرض.
    source: takhreej || clean(item.source),
    number: sourceLocation,
    ruling,
    takhreej,
    origin: 'dorar',
    provider: 'الباحث الحديثي',
    contentSource: 'الدرر السنية',
    raw: item,
  };
}

async function search(query) {
  const q = String(query || '').trim();
  if (!q) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  try {
    const params = new URLSearchParams({ cors: '1', q });
    const response = await fetch(`${SEARCH_ENDPOINT}?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`Hadith search HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.data)) throw new Error('Unexpected hadith search response');

    console.info(`Hadith search: ${payload.data.length} results`);
    return payload.data.map(normalizeResult).filter((x) => x.text);
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('انتهت مهلة الاتصال بالباحث الحديثي.');
    throw new Error(`تعذر الوصول إلى الباحث الحديثي: ${err?.message || String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

export const activeRoute = () => 'hadith-search-api';

export async function searchFromBrowser(query) {
  return search(query);
}
