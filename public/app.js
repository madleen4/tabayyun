// واجهة تبين. كل نص يُعرض عبر textContent (لا innerHTML) لمنع حقن الشيفرة.
import { analyzeText, checkHadith, findAlternatives, buildCorrected, rephrase, getConfig, hasArabic, FULL_MAX, activeRoute } from '/pipeline.js';
import { readUploadedFile } from '/upload.js';
import { makeDocx, download } from '/docx.js';

const $ = (id) => document.getElementById(id);
const textEl = $('text');
const readerEl = $('reader');
const statusEl = $('status');
const resultsEl = $('results');
const summaryEl = $('summary');

// شاشة البداية: تختفي بعد اكتمال الحركة، أو عند الضغط عليها
const splash = $('splash');
const hideSplash = () => splash.classList.add('hide');
splash.addEventListener('click', hideSplash);
setTimeout(hideSplash, matchMedia('(prefers-reduced-motion: reduce)').matches ? 300 : 2600);

const SAMPLE = `طلب العلم من أعظم القربات، قال رسول الله ﷺ: «اطلبوا العلم ولو بالصين».
والنية أساس العمل، وقد قال النبي ﷺ: «إنما الأعمال بالنوايا».
وقال ﷺ: «الدين النصيحة»، فلنتناصح فيما بيننا.`;

const STATUS_CLASS = {
  'ثابت': 's-sound', 'ضعيف': 's-weak', 'موضوع': 's-fab', 'مختلف فيه': 's-mixed',
  'لم يُعثر عليه': 's-none', 'تعذّر التحقق': 's-error',
};

// شرح كل حالة كما يظهر في بطاقة الحديث
const STATUS_META = {
  'ثابت': { meaning: 'صححه المحدثون أو حسّنوه، فيصح الاستشهاد به.' },
  'ضعيف': { meaning: 'ضعّفه المحدثون، فلا يُجزم بنسبته إلى النبي ﷺ.' },
  'موضوع': { meaning: 'حكموا بأنه مكذوب أو لا أصل له، فلا يُنشر منسوباً إلى النبي ﷺ.' },
  'مختلف فيه': { meaning: 'تعارضت أحكام المحدثين، وهي معروضة أدناه كما وردت.' },
  'لم يُعثر عليه': { meaning: 'لم يُوجد أصل مطابق بثقة كافية، وهذا لا يعني أنه مكذوب.' },
  'تعذّر التحقق': { meaning: 'تعذّر الوصول إلى المصادر الآن، فلم يُحكم عليه.' },
};

const STATUS_ICON = {
  'ثابت': 'ok', 'ضعيف': 'warn', 'موضوع': 'x', 'مختلف فيه': 'scale',
  'لم يُعثر عليه': 'q', 'تعذّر التحقق': 'warn',
};

// أيقونة من مجموعة الأيقونات المعرّفة في index.html
function icon(name) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

const AR = (n) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

// الأقسام: قسم واحد ظاهر في كل مرة حسب الرابط (#check، #how، ...)
function showPage() {
  const id = (location.hash || '#check').slice(1);
  const pages = document.querySelectorAll('[data-page]');
  const target = [...pages].some((p) => p.dataset.page === id) ? id : 'check';
  pages.forEach((p) => { p.hidden = p.dataset.page !== target; });
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.getAttribute('href') === `#${target}`));
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', showPage);
showPage();

const state = { text: '', items: [], choices: [], corrected: null, filter: null, body: '', fileName: '' };

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}
const setStatus = (m, err = false) => { statusEl.textContent = m; statusEl.classList.toggle('error', err); };
const busy = (on) => {
  ['analyze', 'sample', 'edit'].forEach((id) => { $(id).disabled = on; });
  $('sheet').classList.toggle('working', on);
};
const progress = (p) => { $('progressBar').style.width = `${Math.round(p * 100)}%`; };


// ---------- زر واحد: يفحص النص كله، أو الجزء المظلل إن وُجد ----------
const selection = () => {
  const { selectionStart: a, selectionEnd: b, value } = textEl;
  const q = value.slice(a, b).trim();
  return q.length >= 4 ? { quote: q, start: value.indexOf(q, a) } : null;
};
const syncAnalyzeLabel = () => { $('analyzeLabel').textContent = selection() ? 'تحقّق من المحدد' : 'تحقّق'; };
['select', 'keyup', 'mouseup', 'input'].forEach((ev) => textEl.addEventListener(ev, syncAnalyzeLabel));
document.addEventListener('selectionchange', () => { if (document.activeElement === textEl) syncAnalyzeLabel(); });

// ---------- النص المُعلَّم: كل حديث مظلل بلون حالته داخل نص المستخدم ----------
function renderReader(text, items) {
  readerEl.replaceChildren();
  const order = items.map((it, i) => ({ it, i })).sort((a, b) => a.it.start - b.it.start);
  let pos = 0;
  for (const { it, i } of order) {
    if (it.start < pos) continue;
    readerEl.append(text.slice(pos, it.start));
    // span لا button: حتى يلتف الحديث الطويل مع السطر كبقية النص
    const m = el('span', 'hl pending', text.slice(it.start, it.end));
    m.id = `hl-${i}`;
    m.tabIndex = 0;
    m.setAttribute('role', 'button');
    m.title = 'جارٍ التحقق…';
    m.addEventListener('click', () => focusEntry(i));
    m.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focusEntry(i); } });
    const n = el('sup', 'hl-num', AR(i + 1));
    readerEl.append(m, n);
    pos = it.end;
  }
  readerEl.append(text.slice(pos));
}

function markReader(i, status) {
  const m = $(`hl-${i}`);
  if (!m) return;
  m.className = `hl ${STATUS_CLASS[status] || ''}`;
  m.title = status;
  m.nextSibling?.classList.add(...(STATUS_CLASS[status] ? [STATUS_CLASS[status]] : []));
}

function focusEntry(i) {
  const e = $(`entry-${i}`);
  if (!e) return;
  e.scrollIntoView({ behavior: 'smooth', block: 'center' });
  e.classList.remove('flash');
  void e.offsetWidth;
  e.classList.add('flash');
}

function showReader(on) {
  textEl.hidden = on;
  readerEl.hidden = !on;
  $('analyze').hidden = on;
  $('edit').hidden = !on;
  $('sheet').classList.toggle('read', on);
}

$('edit').addEventListener('click', () => {
  showReader(false);
  textEl.focus();
  textEl.setSelectionRange(textEl.value.length, textEl.value.length);
  syncAnalyzeLabel();
});

// ---------- بطاقة الحديث ----------
function rulingsBlock(judged) {
  const d = el('details');
  d.append(el('summary', '', `أحكام المحدثين (${AR(judged.length)})`));
  const ul = el('ul', 'rulings');
  for (const j of judged.slice(0, 8)) {
    const li = el('li');
    li.append(el('span', 'rtext', `«${j.text}»`));
    li.append(el('span', 'rmeta', [j.muhaddith, j.source, j.number].filter(Boolean).join('، ')));
    if (j.ruling) li.append(el('span', `rruling ${j.cat ? STATUS_CLASS[j.cat] : ''}`, j.ruling));
    ul.append(li);
  }
  d.append(ul);
  return d;
}

function diffBox(diff) {
  const box = el('div', 'box warn');
  box.append(el('h3', '', 'لفظك يختلف عن لفظ المصدر'));
  const user = el('p', 'line');
  user.append(el('span', 'label', 'في نصك'));
  const uw = el('span', 'words');
  diff.userWords.forEach((w, i) => {
    uw.append(el(w.ok ? 'span' : 'mark', '', w.w));
    if (i < diff.userWords.length - 1) uw.append(' ');
  });
  user.append(uw);
  const src = el('p', 'line');
  src.append(el('span', 'label', 'في المصدر'), el('span', 'words src', diff.sourceWindow));
  box.append(user, src);
  return box;
}

function fullBox(full) {
  const box = el('div', 'box');
  box.append(el('h3', '', 'الحديث كاملاً في المصدر'));
  box.append(el('p', 'words src', `«${full.text}»`));
  box.append(el('p', 'rmeta', [full.muhaddith, full.source, full.number, full.ruling].filter(Boolean).join('، ')));
  return box;
}

function option(name, label, checked, onChange, extra, iconName = 'check', labelClass = '') {
  const l = el('label', 'opt');
  const r = document.createElement('input');
  r.type = 'radio'; r.name = name; r.checked = checked;
  r.addEventListener('change', onChange);
  const body = el('span', 'optbody');
  body.append(el('span', labelClass, label));
  if (extra) body.append(...extra);
  l.append(r, icon(iconName), body);
  return l;
}

function entryHead(status, idx) {
  const head = el('div', 'entry-head');
  const pill = el('span', `pill ${STATUS_CLASS[status] || ''}`);
  pill.append(icon(STATUS_ICON[status] || 'q'), status);
  head.append(pill, el('span', 'num', `الحديث ${AR(idx + 1)}`));
  return head;
}

function pendingEntry(it, idx) {
  const li = el('li', 'entry pending');
  li.id = `entry-${idx}`;
  const head = el('div', 'entry-head');
  head.append(el('span', 'note', 'جارٍ البحث في المصادر…'), el('span', 'num', `الحديث ${AR(idx + 1)}`));
  li.append(head, el('p', 'quote', `«${it.quote}»`));
  return li;
}

function renderItem(it, idx) {
  const cls = STATUS_CLASS[it.status] || '';
  const li = el('li', `entry ${cls}`);
  li.id = `entry-${idx}`;
  const card = li;
  const meta = STATUS_META[it.status] || { meaning: '' };
  card.append(entryHead(it.status, idx));
  if (meta.meaning) card.append(el('p', 'meaning', meta.meaning));
  card.append(el('p', 'quote', `«${it.quote}»`));
  if (it.note && it.note !== meta.meaning) card.append(el('p', 'note', it.note));

  const opts = el('div', 'opts');
  const name = `c${idx}`;
  const set = (choice) => () => { state.choices[idx] = choice; updateCorrected(); };
  opts.append(option(name, 'إبقاء النص كما هو', true, set({ mode: 'keep' }), null, 'check'));

  if (it.diff?.distorted && it.diff.sourceWindow && it.status !== 'لم يُعثر عليه') {
    card.append(diffBox(it.diff));
    opts.append(option(name, 'استبدال اللفظ بلفظ المصدر', false, set({ mode: 'source' }), null, 'swap'));
  }

  if (it.full && it.status !== 'لم يُعثر عليه') {
    card.append(fullBox(it.full));
    if (it.full.text.length <= FULL_MAX) opts.append(option(name, 'استبدال بالحديث كاملاً من المصدر', false, set({ mode: 'full' }), null, 'swap'));
  }

  if (['ضعيف', 'موضوع', 'مختلف فيه', 'لم يُعثر عليه'].includes(it.status)) {
    opts.append(option(name, 'حذف هذا القول من النص', false, set({ mode: 'remove' }), null, 'trash'));
  }

  if (['ضعيف', 'موضوع', 'مختلف فيه', 'لم يُعثر عليه'].includes(it.status)) {
    const btn = el('button', 'btn-link');
    const btnLabel = el('span', '', 'اقتراح حديث ثابت في المعنى نفسه');
    btn.append(icon('bulb'), btnLabel);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btnLabel.textContent = 'جارٍ البحث عن بدائل ثابتة…';
      try {
        const alts = await findAlternatives(it.quote);
        if (!alts.length) { btn.replaceWith(el('p', 'note', 'لم يُعثر على بديل ثابت بثقة كافية.')); return; }
        btn.remove();
        // الأقصر أولاً: أسهل في الاستبدال داخل المنشور
        alts.sort((a, b) => a.text.length - b.text.length).forEach((a) => {
          const m = el('span', 'rmeta', [a.partial ? 'جزء من حديث أطول' : '', a.muhaddith, a.source, a.number, a.ruling].filter(Boolean).join('، '));
          opts.append(option(name, `«${a.text}»`, false, set({ mode: 'alt', alt: a }), [m], 'bulb', 'alt-text'));
        });
      } catch {
        btn.disabled = false;
        btnLabel.textContent = 'تعذّر البحث، أعد المحاولة';
      }
    });
    opts.append(btn);
  }

  // لا داعي للخيارات إن لم يوجد إلا «إبقاء النص»
  if (opts.children.length > 1) card.append(el('p', 'choose', 'ماذا تريد أن تفعل بهذا الحديث؟'), opts);
  if (it.judged?.length) card.append(rulingsBlock(it.judged));
  return li;
}

// ---------- الحكم العام على النص ----------
function needsFix(it) {
  return ['موضوع', 'ضعيف'].includes(it.status) || (it.status === 'ثابت' && it.diff?.distorted);
}

function renderReadiness() {
  const r = $('readiness');
  r.replaceChildren();
  const pairs = state.items.map((it, i) => [it, state.choices[i]?.mode || 'keep']).filter(([it]) => it);
  const items = pairs.map(([it]) => it);
  if (!items.length) return;
  const open = pairs.filter(([it, m]) => needsFix(it) && m === 'keep').map(([it]) => it);
  const fixed = pairs.filter(([it, m]) => needsFix(it) && m !== 'keep').length;
  const unsure = pairs.filter(([it, m]) => m !== 'remove' && ['لم يُعثر عليه', 'مختلف فيه', 'تعذّر التحقق'].includes(it.status)).length;
  let cls; let title; let text;
  if (open.length) {
    const fab = open.filter((it) => ['موضوع', 'ضعيف'].includes(it.status)).length;
    const dist = open.filter((it) => it.status === 'ثابت').length;
    const parts = [];
    if (fab) parts.push(fab === 1 ? 'حديث لا تصح نسبته إلى النبي ﷺ' : `${AR(fab)} أحاديث لا تصح نسبتها إلى النبي ﷺ`);
    if (dist) parts.push(dist === 1 ? 'حديث بلفظ يخالف المصدر' : `${AR(dist)} أحاديث بألفاظ تخالف المصدر`);
    cls = fab ? 's-fab' : 's-weak';
    title = 'نصك يحتاج إلى تصحيح قبل نشره';
    text = `فيه ${parts.join('، و')}. اختر التصحيح من بطاقة كل حديث.`;
  } else if (unsure) {
    cls = 's-mixed';
    title = fixed ? 'صُحّح ما يلزم، وبقي ما يحتاج تثبّتاً' : 'في النص ما يحتاج تثبّتاً';
    text = unsure === 1
      ? 'قول واحد لم يُحسم حكمه، فالأحوط ألا يُنسب إلى النبي ﷺ حتى يُتثبّت منه.'
      : `${AR(unsure)} أقوال لم يُحسم حكمها، فالأحوط ألا تُنسب إلى النبي ﷺ حتى يُتثبّت منها.`;
  } else {
    cls = 's-sound';
    title = fixed ? 'النص جاهز للنشر بعد تعديلاتك' : 'النص جاهز للنشر';
    text = 'كل الأحاديث في نصك ثابتة بألفاظها، ومعها مصادرها.';
  }
  r.className = `readiness ${cls}`;
  r.append(icon({ 's-fab': 'x', 's-weak': 'warn', 's-mixed': 'q', 's-sound': 'ok' }[cls]));
  const t = el('div', 'r-text');
  t.append(el('strong', '', title), el('span', '', text));
  r.append(t);
}

// أزرار التصفية: «الكل» ثم عدد كل حالة. الضغط على حالة يعرض أحاديثها فقط.
function renderSummary() {
  summaryEl.replaceChildren();
  const items = state.items.filter(Boolean);
  if (!items.length) return;
  const counts = {};
  items.forEach((it) => { counts[it.status] = (counts[it.status] || 0) + 1; });
  if (state.filter && !counts[state.filter]) state.filter = null;
  const make = (status, label, iconName) => {
    const b = el('button', `chip ${status ? STATUS_CLASS[status] || '' : 'all'}`);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(state.filter === status));
    if (iconName) b.append(icon(iconName));
    b.append(label);
    b.addEventListener('click', () => { state.filter = status; renderSummary(); applyFilter(); });
    summaryEl.append(b);
  };
  make(null, `الكل ${AR(items.length)}`, null);
  for (const [s, n] of Object.entries(counts)) make(s, `${s} ${AR(n)}`, STATUS_ICON[s] || 'q');
}

function applyFilter() {
  state.items.forEach((it, i) => {
    const e = $(`entry-${i}`);
    if (e) e.hidden = Boolean(state.filter && it && it.status !== state.filter);
  });
}

// ---------- النص النهائي ----------
function sourcesText() {
  const s = state.corrected.sources;
  return s.length ? `\n\nالمصادر:\n${s.map((x) => `- ${x}`).join('\n')}` : '';
}

// النص النهائي: المتن ثم المصادر
function setFinal(body) {
  state.body = body;
  $('corrected').value = body + sourcesText();
}

function updateCorrected() {
  state.corrected = buildCorrected(state.text, state.items, state.choices);
  setFinal(state.corrected.text);
  // زر تحسين الصياغة يظهر فقط إذا اختار المستخدم تعديلاً (استبدال أو حذف)
  $('polish').hidden = !state.corrected.touched.length;
  $('polish').disabled = false;
  $('polishLabel').textContent = 'تحسين الصياغة حول التعديلات';
  $('unpolish').hidden = true;
  $('polishNote').hidden = true;
  renderReadiness();
}

// تحسين الصياغة بالذكاء الاصطناعي: تُرسل الفقرات المعدّلة فقط، وألفاظ الأحاديث محمية لا تُمس.
$('polish').addEventListener('click', async () => {
  const c = state.corrected;
  const note = $('polishNote');
  $('polish').disabled = true;
  $('polishLabel').textContent = 'جارٍ تحسين الصياغة…';
  note.hidden = true;
  try {
    const { text: out, changed, rejected } = await rephrase(c.text, c.spans, c.touched);
    if (!changed) {
      note.textContent = rejected
        ? 'لم يُعتمد اقتراح الذكاء الاصطناعي لأنه خالف ضوابط حماية النص الشرعي، فبقي النص كما هو.'
        : 'الكلام حول التعديلات مستقيم، ولم يحتج إلى تغيير.';
      $('polish').hidden = true;
    } else {
      setFinal(out);
      note.textContent = 'عُدّلت صياغة الكلام المحيط بالتعديلات، وبقيت ألفاظ الأحاديث كما هي. راجع النص قبل نسخه.';
      $('polish').hidden = true;
      $('unpolish').hidden = false;
    }
  } catch (e) {
    note.textContent = `تعذّر تحسين الصياغة: ${e.message}`;
    $('polish').disabled = false;
    $('polishLabel').textContent = 'إعادة المحاولة';
  }
  note.hidden = false;
});

$('unpolish').addEventListener('click', () => updateCorrected());

// ---------- الفحص ----------
function startRun(text) {
  $('legend').hidden = true;
  state.text = text;
  state.items = [];
  state.choices = [];
  state.filter = null;
  resultsEl.replaceChildren();
  summaryEl.replaceChildren();
  $('readiness').replaceChildren();
  $('report').hidden = true;
  $('correctedBox').hidden = true;
  progress(0.05);
}

function onExtracted(items) {
  state.items = new Array(items.length);
  state.choices = items.map(() => ({ mode: 'keep' }));
  renderReader(state.text, items);
  showReader(true);
  items.forEach((it, i) => resultsEl.append(pendingEntry(it, i)));
  progress(0.2);
}

function onItem(i, it) {
  state.items[i] = it;
  $(`entry-${i}`)?.replaceWith(renderItem(it, i));
  applyFilter();
  markReader(i, it.status);
  const done = state.items.filter(Boolean).length;
  progress(0.2 + 0.8 * (done / state.choices.length));
  $('report').hidden = false;
  renderSummary();
  renderReadiness();
}

function finishRun(items, engine, rejected, secs) {
  state.items = items;
  if (state.choices.length !== items.length) state.choices = items.map(() => ({ mode: 'keep' }));
  renderSummary();
  $('report').hidden = !items.length;
  $('correctedBox').hidden = !items.length;
  if (items.length) updateCorrected();
  progress(0);
  const how = engine === 'rules' ? '، دون ذكاء اصطناعي' : '';
  const rej = rejected ? `، واستُبعد ${AR(rejected)} مقطع لأنه غير موجود في نصك` : '';
  setStatus(items.length
    ? `فُحص ${countWord(items.length)}${how}${rej}.`
    : 'لم تُوجد أحاديث منسوبة إلى النبي ﷺ في النص. إن كان فيه حديث، ظلّله ثم اضغط «تحقّق».');
}

function countWord(n) {
  if (n === 1) return 'قول واحد';
  if (n === 2) return 'قولان';
  return `${AR(n)} ${n <= 10 ? 'أقوال' : 'قولاً'}`;
}

// فحص قول واحد (نص قصير بلا نسبة، أو جزء ظلّله المستخدم)
async function checkOne(quote, start, t0) {
  const item = { quote, start, end: start + quote.length, kind: 'hadith' };
  onExtracted([item]);
  const r = { ...item, ...(await checkHadith(quote)) };
  onItem(0, r);
  finishRun([r], 'manual', 0, (performance.now() - t0) / 1000);
}

$('analyze').addEventListener('click', async () => {
  const text = textEl.value.trim();
  if (!text) { setStatus('الصق نصاً أولاً.', true); textEl.focus(); return; }
  const sel = selection();
  if (!hasArabic(sel ? sel.quote : text)) {
    setStatus('لم تُوجد أحاديث في النص. تَبَيَّن يفحص الأحاديث المكتوبة بالعربية.');
    return;
  }
  startRun(textEl.value);
  busy(true);
  const t0 = performance.now();
  try {
    if (sel) {
      // المستخدم ظلّل جزءاً: يُفحص وحده
      setStatus('جارٍ التحقق…');
      await checkOne(sel.quote, sel.start, t0);
      return;
    }
    const { items, engine, rejected } = await analyzeText(state.text, { onProgress: setStatus, onExtracted, onItem });
    if (!items.length && text.split(/\s+/).length <= 20 && hasArabic(text)) {
      // نص قصير بلا نسبة صريحة: قد يكون حديثاً لُصق وحده، فيُبحث عنه في المصادر.
      // إن لم يطابق شيئاً فهو كلام عادي، ولا تُعرض له بطاقة.
      const r = await checkHadith(text);
      if (r.status === 'لم يُعثر عليه') {
        showReader(false);
        $('legend').hidden = false;
        progress(0);
        setStatus('لم تُوجد أحاديث في النص: لا نسبة إلى النبي ﷺ، ولم يطابق النص حديثاً في المصادر.');
      } else {
        const start = state.text.indexOf(text);
        const item = { quote: text, start, end: start + text.length, kind: 'hadith', ...r };
        onExtracted([item]);
        onItem(0, item);
        finishRun([item], 'manual', 0, (performance.now() - t0) / 1000);
      }
    } else {
      if (!items.length) { showReader(false); $('legend').hidden = false; }
      finishRun(items, engine, rejected, (performance.now() - t0) / 1000);
    }
  } catch (e) {
    console.error(e);
    progress(0);
    showReader(false);
    setStatus(`تعذّر الفحص: ${e.message}`, true);
  } finally {
    busy(false);
    syncAnalyzeLabel();
    showSourceNote();
  }
});

// يوضح للمستخدم إن كانت النتائج من المصدر الاحتياطي لا من الدرر
function showSourceNote() {
  let n = document.getElementById('srcnote');
  if (!n) { n = el('p', 'badge'); n.id = 'srcnote'; $('mode').after(n); }
  const local = activeRoute() === 'local';
  n.hidden = !local;
  n.textContent = local ? 'تعذّر الوصول إلى الدرر السنية الآن، فالنتائج من المصدر الاحتياطي (تسعة كتب من كتب السنة)، وقد لا تشمل كل أحكام المحدثين.' : '';
}

$('sample').addEventListener('click', () => { showReader(false); state.fileName = ''; textEl.value = SAMPLE; syncAnalyzeLabel(); });

$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const isImage = f.type.startsWith('image/');
  setStatus(isImage ? 'جارٍ قراءة النص من الصورة…' : 'جارٍ قراءة الملف…');
  try {
    showReader(false);
    const { text, note } = await readUploadedFile(f);
    textEl.value = text.replace(/\n[ \t]*(\n[ \t]*)+/g, '\n');
    syncAnalyzeLabel();
    state.fileName = f.name;
    setStatus(note || (isImage ? 'قُرئ النص من الصورة. راجعه وصحّح ما قد يخطئ فيه، ثم اضغط «تحقّق».' : 'قُرئ الملف. راجع النص ثم اضغط «تحقّق».'));
  } catch (err) {
    setStatus(`${isImage ? 'تعذّرت قراءة الصورة' : 'تعذّرت قراءة الملف'}: ${err.message.replace(/^تعذّرت قراءة الصورة[،:]?\s*/, '')}`, true);
  }
  e.target.value = '';
});

// تنزيل النص بعد التحقق ملف Word ليعدّل عليه المستخدم: نصه فقط، ثم المصادر.
$('download').addEventListener('click', () => {
  const blocks = state.body.split('\n').map((l) => (l.trim() ? { type: 'p', text: l } : { type: 'gap' }));
  if (state.corrected.sources.length) {
    blocks.push({ type: 'gap' }, { type: 'p', runs: [{ text: 'المصادر:', bold: true }] });
    state.corrected.sources.forEach((x) => blocks.push({ type: 'p', text: `- ${x}`, size: 24 }));
  }
  const base = state.fileName ? state.fileName.replace(/\.[^.]+$/, '') : 'تبين';
  download(makeDocx(blocks), `${base} - بعد التحقق.docx`);
});

$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('corrected').value); }
  catch { $('corrected').select(); document.execCommand('copy'); }
  $('copyLabel').textContent = 'نُسخ النص';
  setTimeout(() => { $('copyLabel').textContent = 'نسخ النص'; }, 1800);
});

getConfig().then(({ ai }) => {
  if (!ai) { $('mode').hidden = false; $('mode').textContent = 'الذكاء الاصطناعي غير مفعّل: تُكتشف الأحاديث بين علامات التنصيص فقط.'; }
});