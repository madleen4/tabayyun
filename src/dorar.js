// الوصول إلى الموسوعة الحديثية في الدرر السنية.
// عرض لحظي فقط: لا تخزين ولا إعادة نشر لنتائج الدرر.
// يُستدعى من متصفح المستخدم مباشرة، كما صُممت الخدمة للمواقع؛ الطلبات من الخادم ترفضها الدرر (403).

const API = 'https://dorar.net/dorar_api.json';

const FIELDS = [
  ['rawi', 'الراوي:'],
  ['muhaddith', 'المحدث:'],
  ['source', 'المصدر:'],
  ['number', 'الصفحة أو الرقم:'],
  ['ruling', 'خلاصة حكم المحدث:'],
];

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

// يحوّل بطاقة المعلومات إلى حقول، ولا يفترض وجود كل الحقول.
// يُقسَّم على وسم كل عنوان، لأن «المحدث:» جزء من «خلاصة حكم المحدث:».
function parseInfo(infoHtml) {
  const out = { rawi: '', muhaddith: '', source: '', number: '', ruling: '' };
  const parts = infoHtml.split(/<span class="info-subtitle">/).slice(1);
  for (const part of parts) {
    const text = stripTags(part);
    for (const [key, label] of FIELDS) {
      if (text.startsWith(label)) {
        out[key] = text.slice(label.length).trim();
        break;
      }
    }
  }
  return out;
}

export function parseDorarHtml(html = '') {
  const results = [];
  const blocks = html.split(/<div class="hadith"/).slice(1);
  for (const block of blocks) {
    const hadithEnd = block.indexOf('</div>');
    const hadithHtml = block.slice(block.indexOf('>') + 1, hadithEnd);
    let text = stripTags(hadithHtml).replace(/^\d+\s*-\s*/, '');
    const truncated = /\.\s*\.\s*\./.test(text);
    text = text.replace(/[\s.]+$/, '').trim();

    const infoStart = block.indexOf('<div class="hadith-info"');
    const infoHtml = infoStart === -1 ? '' : block.slice(infoStart, block.indexOf('</div>', infoStart));
    const info = parseInfo(infoHtml);

    if (text) results.push({ text, truncated, ...info });
  }
  return results;
}

export function dorarSearchLink(query) {
  return `https://dorar.net/hadith/search?q=${encodeURIComponent(query)}`;
}

export function dorarApiUrl(query) {
  return `${API}?skey=${encodeURIComponent(query)}`;
}

// يحوّل نص استجابة الدرر إلى نتائج. يتحمل علامة BOM أو غلاف JSONP.
export function parseDorarResponse(raw = '') {
  const text = String(raw).replace(/^\uFEFF/, '').trim();
  const open = text.indexOf('(');
  const jsonText = text.startsWith('{') ? text : text.slice(open + 1, text.lastIndexOf(')'));
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error(`Dorar returned non-JSON: ${text.slice(0, 120)}`);
  }
  return parseDorarHtml(data?.ahadith?.result ?? '');
}

// يعمل في المتصفح وفي Node. لا ترويسات مخصصة حتى لا يحتاج المتصفح طلباً تمهيدياً (CORS).
export async function searchDorar(query, { fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(dorarApiUrl(query), { signal: ctrl.signal });
    if (!res.ok) throw new Error(`Dorar HTTP ${res.status}`);
    return parseDorarResponse(await res.text());
  } finally {
    clearTimeout(timer);
  }
}
