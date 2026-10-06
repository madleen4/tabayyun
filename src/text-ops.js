// عمليات على النص لا تحتاج شبكة: تُستخدم في المتصفح (عبر /lib/) وتُختبر في Node.
import { normalizeArabic } from './normalize.js';

const TASHKEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
export const plain = (s) => s.replace(TASHKEEL, '').replace(/[«»"“”().،,:؛!؟?]/g, ' ').replace(/\s+/g, ' ').trim();

// نص عربي فعلي: ثلاثة أحرف عربية متتالية على الأقل
export const hasArabic = (s) => /[\u0621-\u064A]{3}/.test(String(s || ''));

// إذا أعاد النموذج الحديث مع علامتي التنصيص، تُزالان حتى لا تتكرر («««…»»»)
export function trimQuotes(it) {
  let { quote, start, end } = it;
  while (quote.length > 2 && /^[«"“]/.test(quote) && /[»"”]$/.test(quote)) {
    quote = quote.slice(1, -1); start += 1; end -= 1;
  }
  const lead = quote.length - quote.trimStart().length;
  const tail = quote.length - quote.trimEnd().length;
  return { ...it, quote: quote.trim(), start: start + lead, end: end - tail };
}

// الحديث الطويل: يُقتطع منه الموضع الذي فيه المعنى المطلوب فقط، ليصلح للاستبدال في المنشور.
export const MAX_ALT = 110;
export function excerpt(text, query) {
  if (plain(text).length <= MAX_ALT) return text;
  // نسخة مطبّعة من النص مع موضع كل حرف منها في الأصل
  let norm = '';
  const map = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/[\s«»"“”().،,:؛!؟?.]/.test(ch)) {
      if (norm && !norm.endsWith(' ')) { norm += ' '; map.push(i); }
      continue;
    }
    const n = normalizeArabic(ch);
    if (n) { norm += n; map.push(i); }
  }
  const qw = normalizeArabic(query).split(' ').filter(Boolean);
  let at = -1;
  let len = 0;
  for (let n = qw.length; n >= 2 && at < 0; n--) {
    const q = qw.slice(0, n).join(' ');
    at = norm.indexOf(q);
    len = q.length;
  }
  if (at < 0) return text;
  // البداية: أول الكلمة. النهاية: قبل بداية جملة جديدة («ومن»، «وما»…) أو علامة وقف
  let s = norm.lastIndexOf(' ', at) + 1;
  const rest = norm.slice(at + len);
  const stop = rest.search(/ و(من|ما|الله|اذا|لا) /);
  let e = at + len + (stop >= 0 ? stop : rest.length);
  if (e - s > MAX_ALT * 1.6) e = norm.lastIndexOf(' ', s + Math.round(MAX_ALT * 1.6));
  let end = map[e - 1] + 1;
  while (end < text.length && /[\u064B-\u0652\u0670]/.test(text[end])) end++; // حركات الحرف الأخير
  let out = text.slice(map[s], end);
  if (/^و[\u064B-\u0652]*م[\u064B-\u0652]*[نا]/.test(out)) out = out.replace(/^و[\u064B-\u0652]*/, '');
  out = out.replace(/[\s،,.:؛]+$/, '').trim();
  return out.length >= 12 ? out : text;
}

// التوثيق بالطريقة المعتادة: «أخرجه البخاري في صحيحه (5641)» أو «سنن الترمذي (2646)، وقال الألباني: صحيح».
const flat = (s) => String(s || '').replace(/\s+/g, ' ').trim();
export function citation(r) {
  const num = r.number ? ` (${r.number})` : '';
  const ruling = flat(r.ruling);
  if (/^أخرجه/.test(ruling)) return `${ruling}${num}`;
  const where = r.source ? `${flat(r.source)}${num}` : '';
  const said = ruling ? (r.muhaddith ? `وقال ${flat(r.muhaddith)}: ${ruling}` : `وحكمه: ${ruling}`) : '';
  return [where, said].filter(Boolean).join('، ');
}

// عبارة النسبة قبل الحديث مباشرة (مثل: «، قال رسول الله ﷺ: »)، لتُحذف مع الحديث.
const ATTR_BEFORE = /[،,]?\s*(?:و?(?:قد\s+)?(?:قال|يقول)|عن)\s*(?:رسول الله|النبي|الرسول)?\s*(?:ﷺ|صلى الله عليه وسلم)?\s*[:：]?\s*[«“"]?\s*$/;

// مدى الحذف: عبارة النسبة + الحديث + علامة التنصيص الختامية.
export function removalRange(text, it) {
  const from = Math.max(0, it.start - 80);
  const before = text.slice(from, it.start);
  const m = before.match(ATTR_BEFORE);
  let start = m ? from + m.index : it.start;
  if (!m && /[«“"]$/.test(before)) start -= 1;
  let end = it.end;
  if (/[»”"]/.test(text[end] || '')) end += 1;
  return { start, end };
}

// يبني النص المصحح من اختيارات المستخدم.
// choice: { mode: 'keep' | 'source' | 'alt' | 'remove', alt }
// يعيد النص، ومواضع الأحاديث فيه (لحمايتها عند تعديل الصياغة)، ومواضع التعديلات، والمصادر.
export function buildCorrected(text, items, choices) {
  const edits = [];
  const sources = [];
  items.forEach((it, i) => {
    const c = choices[i] || { mode: 'keep' };
    if (c.mode === 'source' && it.diff?.sourceWindow) {
      edits.push({ i, start: it.start, end: it.end, text: flat(it.diff.sourceWindow) });
      sources.push(`«${flat(it.diff.sourceWindow)}» ${citation(it.diff.ref)}.`);
    } else if (c.mode === 'alt' && c.alt) {
      edits.push({ i, start: it.start, end: it.end, text: flat(c.alt.text) });
      sources.push(`«${flat(c.alt.text)}»${c.alt.partial ? ' (جزء من حديث)' : ''} ${citation(c.alt)}.`);
    } else if (c.mode === 'remove') {
      edits.push({ i, ...removalRange(text, it), text: '', remove: true });
    } else if (it.status === 'ثابت' && it.diff?.ref && !it.diff.distorted) {
      // لا يُنسب لفظ المستخدم إلى المصدر إذا كان يخالفه
      sources.push(`«${flat(it.quote)}» ${citation(it.diff.ref)}.`);
    }
  });
  edits.sort((a, b) => a.start - b.start);
  let out = '';
  let last = 0;
  const applied = [];
  const touched = [];
  const spanOf = {};
  for (const e of edits) {
    if (e.start < last) continue; // تداخل نادر: يُتجاهل التعديل الثاني
    out += text.slice(last, e.start);
    const pos = out.length;
    out += e.text;
    touched.push(pos);
    if (!e.remove) spanOf[e.i] = { start: pos, end: pos + e.text.length };
    applied.push(e);
    last = e.end;
  }
  out += text.slice(last);
  // مواضع الأحاديث التي لم تُعدَّل بعد إزاحة ما قبلها
  const shiftAt = (p) => applied.filter((e) => e.end <= p).reduce((s, e) => s + e.text.length - (e.end - e.start), 0);
  const spans = [];
  items.forEach((it, i) => {
    if (spanOf[i]) spans.push(spanOf[i]);
    else if (!applied.some((e) => e.i === i)) spans.push({ start: it.start + shiftAt(it.start), end: it.end + shiftAt(it.start) });
  });
  return { text: out, spans, touched, sources };
}

// تحسين الصياغة: كل فقرة فيها تعديل تُقسَّم إلى parts (كلام الكاتب) وquotes (الأحاديث).
const ATTRIBUTION = /(رسول الله|النبي|ﷺ|صلى الله عليه وسلم)/g;
const QUOTE_MARKS = /[«»"“”]/g;
const count = (str, re) => (str.match(re) || []).length;

export function splitForRephrase(text, spans, touched = []) {
  const lines = text.split('\n');
  const starts = [];
  let pos = 0;
  for (const l of lines) { starts.push(pos); pos += l.length + 1; }
  const lineOf = (p) => { let k = 0; while (k + 1 < starts.length && starts[k + 1] <= p) k++; return k; };
  const targets = [...new Set(touched.map(lineOf))].filter((k) => lines[k].trim());
  const items = targets.map((k) => {
    const a = starts[k];
    const b = a + lines[k].length;
    const inLine = spans.filter((sp) => sp.start >= a && sp.end <= b).sort((x, y) => x.start - y.start);
    const parts = [];
    const quotes = [];
    let cur = a;
    for (const sp of inLine) {
      parts.push(text.slice(cur, sp.start));
      quotes.push(text.slice(sp.start, sp.end));
      cur = sp.end;
    }
    parts.push(text.slice(cur, b));
    return { parts, quotes };
  });
  return { lines, targets, items };
}

// يركّب الناتج: كلام الكاتب المعدّل + ألفاظ الأحاديث الأصلية. يرفض أي اقتراح يخالف الضوابط.
export function applyRephrase({ lines, targets, items }, out) {
  const result = [...lines];
  let changed = 0;
  let rejected = 0;
  targets.forEach((k, n) => {
    const before = items[n].parts;
    const after = out[n]?.parts;
    if (!Array.isArray(after) || after.length !== before.length) { rejected++; return; }
    const oldTalk = before.join('');
    const newTalk = after.map(String).join('');
    // لا نسبة جديدة إلى النبي ﷺ، ولا علامات تنصيص جديدة (أي لا نص منقول جديد)، ولا تغيّر كبير في الطول
    if (count(newTalk, ATTRIBUTION) > count(oldTalk, ATTRIBUTION)
      || count(newTalk, QUOTE_MARKS) > count(oldTalk, QUOTE_MARKS)
      || newTalk.length > oldTalk.length * 2 + 40) { rejected++; return; }
    let line = '';
    after.forEach((p, i) => { line += String(p).replace(/\n+/g, ' '); if (i < items[n].quotes.length) line += items[n].quotes[i]; });
    if (line !== result[k]) { result[k] = line; changed++; }
  });
  return { text: result.join('\n'), changed, rejected };
}

// ---------- نص PDF العربي ----------
// برامج قراءة PDF تفكّك بعض الحروف المركّبة بترتيب معكوس (مثل «اإلمام» بدل «الإمام»، و«ملسو هيلع هللا ىلص» بدل ﷺ).
// يُصلح هنا ما يمكن إصلاحه بأمان، ويُكشف النص المشوّه لقراءته بطريقة أخرى.
const H = '[\\u064B-\\u0652\\u0670]*'; // حركات اختيارية بين الحروف
const W = '(^|[\\s«(])';              // بداية كلمة
const re = (src) => new RegExp(src, 'g');

export function repairPdfArabic(text) {
  // ﷺ يُحمى من التفكيك إلى «صلى الله عليه وسلم»
  return String(text).replace(/ﷺ/g, '\uE000').normalize('NFKC').replace(/\uE000/g, 'ﷺ')
    .replace(/[ \t]+(?=[ً-ْٰ])/g, '') // حركة انفصلت عن حرفها بمسافة: «ال ّذِين»
    .replace(/ملسو\s*هيلع\s*هللا\s*ىلص/g, 'ﷺ')
    .replace(re(`${W}([وفبك]?)ا([إأآ])ل`), '$1$2ال$3')
    // كلمات شائعة تنقلب حروفها المتصلة: يُصلح منها ما لا يلتبس بكلمة صحيحة
    .replace(re(`${W}([وفبكل]?${H})ح(${H})م(${H})م(${H})د`), '$1$2م$4ح$3م$5د')
    .replace(/(^|[\s«(])([وفبكل]?)اال?له(?=[\s.،:»)]|$)/g, '$1$2الله')
    .replace(/(^|[\s«(])([وفبكل]?)اهلل(?=[\s.،:»)]|$)/g, '$1$2الله')
    .replace(re(`${W}ي(${H})ف(${H})(?=\\s)`), '$1ف$3ي$2')
    .replace(re(`${W}م(${H})ل(${H})(?=\\s)`), '$1ل$3م$2')
    .replace(re(`${W}([وفبك]?${H})ا(${H})(ح|خ|ج)(${H})ل`), '$1$2ا$3ل$5$4')
    .replace(re(`ن(${H})ي(${H})ب(${H})(?=[\\s.،:»)]|$)`), 'ن$1ب$3ي$2')
    .replace(/[ \t]+/g, ' ')
    .split('\n').map(fixParens).join('\n');
}

// في السطر العربي قد تنعكس الأقواس: «قال ﷺ: )الحديث(»
function fixParens(line) {
  const open = line.indexOf('(');
  const close = line.indexOf(')');
  if (close === -1 || (open !== -1 && open < close) || !/[؀-ۿ]/.test(line)) return line;
  return line.replace(/[()]/g, (c) => (c === '(' ? ')' : '('));
}

// علامات التشويه (بعد حذف الحركات): كلمات لا تظهر في نص عربي سليم
export function looksGarbledPdf(text) {
  const t = ` ${String(text).normalize('NFKC').replace(/[ً-ْٰ]/g, '').replace(/ملسو هيلع هللا ىلص/g, '')} `;
  const n = (r) => (t.match(r) || []).length;
  const bad = n(/\sاهلل\s/g) + n(/\s[وفبكل]?حممد/g) + n(/\s[وفبك]?(?:اإل|األ|احل|اخل|اجل)/g) + n(/\s[وفبكل]?النيب[\s.،]/g) + n(/\sمل\s/g);
  const yaf = n(/\sيف\s/g);
  const fi = n(/\sفي\s/g);
  return bad >= 2 || (yaf >= 2 && yaf > fi);
}

// يعيد ترتيب مقاطع صفحة PDF: سطراً سطراً من الأعلى، وداخل السطر العربي من اليمين إلى اليسار.
// items: [{ str, x, y }] من pdf.js (transform[4] و transform[5]).
export function orderPdfItems(items) {
  const lines = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    let line = lines.find((l) => Math.abs(l.y - it.y) < 3);
    if (!line) { line = { y: it.y, items: [] }; lines.push(line); }
    line.items.push(it);
  }
  lines.sort((a, b) => b.y - a.y);
  return lines.map((l) => {
    const text = l.items.map((i) => i.str).join('');
    const arabic = (text.match(/[؀-ۿ]/g) || []).length > (text.match(/[A-Za-z]/g) || []).length;
    l.items.sort((a, b) => (arabic ? b.x - a.x : a.x - b.x));
    return l.items.map((i) => i.str).join(' ').replace(/[ \t]+/g, ' ').trim();
  }).join('\n');
}