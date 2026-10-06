// الوصول إلى الموسوعة الحديثية في الدرر السنية.
// عرض لحظي فقط: لا تخزين ولا إعادة نشر لنتائج الدرر.
// JSONP هي الطريقة الرسمية الموثقة لأصحاب المواقع، مع إبقاء fetch كخيار إضافي.

const API = 'https://dorar.net/dorar_api.json';

const FIELDS = [
  ['rawi', 'الراوي:'],
  ['muhaddith', 'المحدث:'],
  ['source', 'المصدر:'],
  ['number', 'الصفحة أو الرقم:'],
  ['ruling', 'خلاصة حكم المحدث:'],
];

function decodeEntities(s) {
  return String(s || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function stripTags(html) {
  return decodeEntities(String(html || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// يحوّل بطاقة المعلومات إلى حقول، ولا يفترض وجود كل الحقول.
function parseInfo(infoHtml) {
  const out = { rawi: '', muhaddith: '', source: '', number: '', ruling: '' };
  const html = String(infoHtml || '');

  // الشكل الحديث للموقع: <span class="info-subtitle">العنوان:</span> القيمة
  const parts = html.split(/<span[^>]*class=["'][^"']*info-subtitle[^"']*["'][^>]*>/i).slice(1);
  for (const part of parts) {
    const text = stripTags(part);
    for (const [key, label] of FIELDS) {
      if (text.startsWith(label)) {
        // نوقف القيمة قبل العنوان التالي إذا جُمعت عدة حقول في نفس المقطع.
        let value = text.slice(label.length).trim();
        for (const [, nextLabel] of FIELDS) {
          const at = value.indexOf(nextLabel);
          if (at > 0) value = value.slice(0, at).trim();
        }
        out[key] = value.replace(/^[|،\s]+|[|،\s]+$/g, '');
        break;
      }
    }
  }

  // إذا كان الشكل الحديث موجودًا، فالحقول غير الموجودة تبقى فارغة.
  // هذا يمنع التباس «المحدث:» داخل عبارة «خلاصة حكم المحدث:».
  if (parts.length) return out;

  // fallback للشكل القديم/المسطح: نقسم النص عند جميع العناوين دفعة واحدة،
  // مع تقديم العناوين الأطول حتى لا تُقرأ «المحدث:» من داخل «خلاصة حكم المحدث:».
  const flat = stripTags(html);
  const labelToKey = new Map(FIELDS.map(([key, label]) => [label, key]));
  const labels = [...labelToKey.keys()].sort((a, b) => b.length - a.length);
  const escaped = labels.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'g');
  const matches = [...flat.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const label = matches[i][1];
    const key = labelToKey.get(label);
    if (!key || out[key]) continue;
    const start = matches[i].index + label.length;
    const end = i + 1 < matches.length ? matches[i + 1].index : flat.length;
    out[key] = flat.slice(start, end).replace(/^[|،\s]+|[|،\s]+$/g, '').trim();
  }
  return out;
}

// تقسيم مرن لبطاقات النتائج في الشكل الحديث والقديم.
function blocksFromHtml(html) {
  const s = String(html || '');
  if (!s.trim()) return [];

  const modern = s.split(/<div[^>]*class=["'][^"']*hadith(?:\s[^"']*)?["'][^>]*>/i).slice(1);
  if (modern.length) return modern;

  // بعض نسخ API القديمة ترجع كل نتيجة داخل item.th دون div.hadith واضح.
  // نقسمها عند ظهور «خلاصة حكم المحدث» مع الاحتفاظ بالنص السابق لكل بطاقة.
  const markers = [...s.matchAll(/خلاصة حكم المحدث\s*:/g)].map((m) => m.index);
  if (!markers.length) return [s];
  const out = [];
  let start = 0;
  for (let i = 0; i < markers.length; i++) {
    const next = i + 1 < markers.length ? markers[i + 1] : s.length;
    // نبحث للخلف عن بداية نتيجة قريبة (رقم - / <span class=result> / <div>)
    let begin = s.lastIndexOf('<div', markers[i]);
    const span = s.lastIndexOf('<span', markers[i]);
    if (span > begin) begin = span;
    if (begin < start) begin = start;
    if (i === 0) begin = Math.max(0, begin);
    out.push(s.slice(begin, next));
    start = next;
  }
  return out.filter((x) => x.trim());
}

export function parseDorarHtml(html = '') {
  const results = [];
  const blocks = blocksFromHtml(html);

  for (const block of blocks) {
    const infoStartMatch = block.match(/<div[^>]*class=["'][^"']*hadith-info[^"']*["'][^>]*>/i);
    const infoStart = infoStartMatch ? block.indexOf(infoStartMatch[0]) : -1;
    const textHtml = infoStart >= 0 ? block.slice(0, infoStart) : block;

    let text = stripTags(textHtml)
      .replace(/^\s*\d+\s*[-–—]\s*/, '')
      .replace(/خلاصة حكم المحدث\s*:.*$/s, '')
      .trim();

    // في بعض النتائج القديمة تلتحق معلومات «الراوي/المحدث...» بالنص نفسه.
    const labels = ['الراوي:', 'المحدث:', 'المصدر:', 'الصفحة أو الرقم:', 'خلاصة حكم المحدث:'];
    const cut = labels.map((x) => text.indexOf(x)).filter((x) => x >= 0);
    if (cut.length) text = text.slice(0, Math.min(...cut)).trim();

    const truncated = /\.\s*\.\s*\./.test(text);
    text = text.replace(/[\s.]+$/, '').trim();

    const info = parseInfo(infoStart >= 0 ? block.slice(infoStart) : block);
    if (text) results.push({ text, truncated, ...info, origin: 'dorar' });
  }

  return results;
}

function payloadHtml(data) {
  const a = data?.ahadith;
  if (!a) return '';
  if (typeof a === 'string') return a;
  if (Array.isArray(a)) {
    return a.map((item) => {
      if (typeof item === 'string') return item;
      return item?.th || item?.result || item?.html || '';
    }).join('\n');
  }
  if (typeof a === 'object') {
    if (typeof a.result === 'string') return a.result;
    return Object.values(a).map((item) => {
      if (typeof item === 'string') return item;
      return item?.th || item?.result || item?.html || '';
    }).join('\n');
  }
  return '';
}

export function parseDorarData(data = {}) {
  return parseDorarHtml(payloadHtml(data));
}

export function dorarSearchLink(query) {
  return `https://dorar.net/hadith/search?q=${encodeURIComponent(query)}`;
}

export function dorarApiUrl(query) {
  return `${API}?skey=${encodeURIComponent(query)}`;
}

// يحوّل نص استجابة الدرر إلى نتائج. يتحمل BOM وغلاف JSONP.
export function parseDorarResponse(raw = '') {
  const text = String(raw).replace(/^\uFEFF/, '').trim();
  const open = text.indexOf('(');
  const jsonText = text.startsWith('{') ? text : (open >= 0 ? text.slice(open + 1, text.lastIndexOf(')')) : text);
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error(`Dorar returned non-JSON: ${text.slice(0, 120)}`);
  }
  return parseDorarData(data);
}

export async function searchDorar(query, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = typeof window === 'undefined'
      ? {
          'User-Agent': 'Mozilla/5.0 (compatible; Tabayyun/1.0; +https://tabayyun-oats.onrender.com)',
          Accept: 'application/json, text/javascript, */*;q=0.1',
          'Accept-Language': 'ar,en;q=0.8',
        }
      : undefined;
    const res = await fetchImpl(dorarApiUrl(query), { signal: ctrl.signal, headers });
    if (!res.ok) throw new Error(`Dorar HTTP ${res.status}`);
    return parseDorarResponse(await res.text());
  } finally {
    clearTimeout(timer);
  }
}