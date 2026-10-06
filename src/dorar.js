// أدوات تحليل نتائج الموسوعة الحديثية في الدرر السنية.
// هذا الملف لا يجري أي طلب مباشر من المتصفح.
// الاتصال بالدرر يتم من dorar-client.js عبر JSONP أو عبر خادم تبيّن.

const API = 'https://dorar.net/dorar_api.json';

const FIELDS = [
  ['rawi', 'الراوي:'],
  ['muhaddith', 'المحدث:'],
  ['source', 'المصدر:'],
  ['number', 'الصفحة أو الرقم:'],
  ['ruling', 'خلاصة حكم المحدث:'],
];

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function stripTags(html) {
  return decodeEntities(
    String(html || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function parseInfo(infoHtml) {
  const out = {
    rawi: '',
    muhaddith: '',
    source: '',
    number: '',
    ruling: '',
  };

  const html = String(infoHtml || '');

  // الشكل الحديث لنتائج الدرر.
  const parts = html
    .split(
      /<span[^>]*class=["'][^"']*info-subtitle[^"']*["'][^>]*>/i
    )
    .slice(1);

  for (const part of parts) {
    const text = stripTags(part);

    for (const [key, label] of FIELDS) {
      if (!text.startsWith(label)) continue;

      let value = text.slice(label.length).trim();

      for (const [, nextLabel] of FIELDS) {
        const at = value.indexOf(nextLabel);

        if (at > 0) {
          value = value.slice(0, at).trim();
        }
      }

      out[key] = value
        .replace(/^[|،\s]+|[|،\s]+$/g, '')
        .trim();

      break;
    }
  }

  if (parts.length) {
    return out;
  }

  // دعم الشكل القديم/المسطح.
  const flat = stripTags(html);

  const labelToKey = new Map(
    FIELDS.map(([key, label]) => [label, key])
  );

  const labels = [...labelToKey.keys()].sort(
    (a, b) => b.length - a.length
  );

  const escaped = labels.map((label) =>
    label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );

  const re = new RegExp(`(${escaped.join('|')})`, 'g');
  const matches = [...flat.matchAll(re)];

  for (let i = 0; i < matches.length; i++) {
    const label = matches[i][1];
    const key = labelToKey.get(label);

    if (!key || out[key]) continue;

    const start = matches[i].index + label.length;

    const end =
      i + 1 < matches.length
        ? matches[i + 1].index
        : flat.length;

    out[key] = flat
      .slice(start, end)
      .replace(/^[|،\s]+|[|،\s]+$/g, '')
      .trim();
  }

  return out;
}

function blocksFromHtml(html) {
  const value = String(html || '');

  if (!value.trim()) {
    return [];
  }

  // الشكل الحديث.
  const modern = value
    .split(
      /<div[^>]*class=["'][^"']*hadith(?:\s[^"']*)?["'][^>]*>/i
    )
    .slice(1);

  if (modern.length) {
    return modern;
  }

  // بعض استجابات API القديمة لا تحتوي div.hadith واضح.
  const markers = [
    ...value.matchAll(/خلاصة حكم المحدث\s*:/g),
  ].map((match) => match.index);

  if (!markers.length) {
    return [value];
  }

  const blocks = [];
  let start = 0;

  for (let i = 0; i < markers.length; i++) {
    const next =
      i + 1 < markers.length
        ? markers[i + 1]
        : value.length;

    let begin = value.lastIndexOf('<div', markers[i]);
    const span = value.lastIndexOf('<span', markers[i]);

    if (span > begin) {
      begin = span;
    }

    if (begin < start) {
      begin = start;
    }

    if (i === 0) {
      begin = Math.max(0, begin);
    }

    blocks.push(value.slice(begin, next));
    start = next;
  }

  return blocks.filter((block) => block.trim());
}

export function parseDorarHtml(html = '') {
  const results = [];
  const blocks = blocksFromHtml(html);

  for (const block of blocks) {
    const infoStartMatch = block.match(
      /<div[^>]*class=["'][^"']*hadith-info[^"']*["'][^>]*>/i
    );

    const infoStart = infoStartMatch
      ? block.indexOf(infoStartMatch[0])
      : -1;

    const textHtml =
      infoStart >= 0
        ? block.slice(0, infoStart)
        : block;

    let text = stripTags(textHtml)
      .replace(/^\s*\d+\s*[-–—]\s*/, '')
      .replace(/خلاصة حكم المحدث\s*:.*$/s, '')
      .trim();

    const labels = [
      'الراوي:',
      'المحدث:',
      'المصدر:',
      'الصفحة أو الرقم:',
      'خلاصة حكم المحدث:',
    ];

    const cuts = labels
      .map((label) => text.indexOf(label))
      .filter((index) => index >= 0);

    if (cuts.length) {
      text = text
        .slice(0, Math.min(...cuts))
        .trim();
    }

    const truncated = /\.{3}|…/.test(text);

    text = text
      .replace(/[\s.]+$/, '')
      .trim();

    const info = parseInfo(
      infoStart >= 0
        ? block.slice(infoStart)
        : block
    );

    if (text) {
      results.push({
        text,
        truncated,
        ...info,
        origin: 'dorar',
      });
    }
  }

  return results;
}

function payloadHtml(data) {
  const ahadith = data?.ahadith;

  if (!ahadith) {
    return '';
  }

  if (typeof ahadith === 'string') {
    return ahadith;
  }

  if (Array.isArray(ahadith)) {
    return ahadith
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        return (
          item?.th ||
          item?.result ||
          item?.html ||
          ''
        );
      })
      .join('\n');
  }

  if (typeof ahadith === 'object') {
    if (typeof ahadith.result === 'string') {
      return ahadith.result;
    }

    return Object.values(ahadith)
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        return (
          item?.th ||
          item?.result ||
          item?.html ||
          ''
        );
      })
      .join('\n');
  }

  return '';
}

export function parseDorarData(data = {}) {
  return parseDorarHtml(payloadHtml(data));
}

export function dorarSearchLink(query) {
  return `https://dorar.net/hadith/search?q=${encodeURIComponent(
    query
  )}`;
}

export function dorarApiUrl(query) {
  return `${API}?skey=${encodeURIComponent(query)}`;
}

// تحليل استجابة نصية عند استخدامها من الخادم.
// يدعم JSON العادي وغلاف JSONP.
export function parseDorarResponse(raw = '') {
  const text = String(raw)
    .replace(/^\uFEFF/, '')
    .trim();

  let jsonText = text;

  if (!text.startsWith('{') && !text.startsWith('[')) {
    const open = text.indexOf('(');
    const close = text.lastIndexOf(')');

    if (open >= 0 && close > open) {
      jsonText = text.slice(open + 1, close);
    }
  }

  let data;

  try {
    data = JSON.parse(jsonText);
  } catch {
    throw new Error(
      `Dorar returned non-JSON: ${text.slice(0, 120)}`
    );
  }

  return parseDorarData(data);
}

/*
 * هذه الدالة للخادم فقط.
 *
 * ممنوع استخدامها مباشرة من المتصفح لأن dorar.net
 * لا يرسل CORS headers للـ fetch العادي.
 *
 * المتصفح يستخدم JSONP من public/dorar-client.js.
 */
export async function searchDorar(
  query,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = 12000,
  } = {}
) {
  if (typeof window !== 'undefined') {
    throw new Error(
      'searchDorar is server-only; browser requests must use JSONP'
    );
  }

  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch is unavailable');
  }

  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const response = await fetchImpl(
      dorarApiUrl(query),
      {
        signal: controller.signal,
        headers: {
          Accept:
            'application/json, text/javascript, */*;q=0.1',
          'Accept-Language': 'ar,en;q=0.8',
          'User-Agent':
            'Mozilla/5.0 (compatible; Tabayyun/1.0)',
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        `Dorar HTTP ${response.status}`
      );
    }

    const raw = await response.text();

    return parseDorarResponse(raw);
  } finally {
    clearTimeout(timer);
  }
}