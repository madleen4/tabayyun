// خط المعالجة في المتصفح: استخراج ← تحقق من الدرر ← حالة ← تحريف ← بدائل ← نص مصحح.
import { searchFromBrowser, activeRoute } from '/dorar-client.js';
import { searchHadeethEnc as searchHadeethEncDirect } from '/lib/hadeethenc.js';
import { pickMatches, alignDiff, similarity, MATCH_THRESHOLD } from '/lib/match.js';
import { decideStatus, classifyRuling } from '/lib/classify.js';
import { normalizeArabic } from '/lib/normalize.js';
import { hasArabic, trimQuotes, excerpt, MAX_ALT, plain, buildCorrected, splitForRephrase, applyRephrase, fullSource } from '/lib/text-ops.js';

export { hasArabic, excerpt, buildCorrected, activeRoute };
export { FULL_MAX } from '/lib/text-ops.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// مهلة قصيرة بين طلبات المصادر احتراماً للخدمات الخارجية.
const pause = () => sleep(300);

async function post(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function getConfig() {
  try { return await (await fetch('/api/config')).json(); } catch { return { ai: false }; }
}

async function searchHadeethEncAny(query) {
  // نبدأ عبر خادم تبيَّن، وإن تعذّر نجرب API الرسمي مباشرة من المتصفح.
  try {
    const res = await fetch(`/api/hadeethenc?q=${encodeURIComponent(query)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HadeethEnc server ${res.status}`);
    return data.results || [];
  } catch (serverErr) {
    try {
      return await searchHadeethEncDirect(query);
    } catch {
      throw serverErr;
    }
  }
}

// استعلامات بحث متدرجة: النص كاملاً، ثم نصفاه (لالتقاط المحرّف الذي لا يجده البحث الحرفي).
function searchQueries(quote) {
  const w = plain(quote).split(' ');
  const qs = [w.slice(0, 8).join(' ')];
  if (w.length >= 3) {
    const half = Math.ceil(w.length / 2);
    qs.push(w.slice(0, Math.min(half, 6)).join(' '));
    qs.push(w.slice(-Math.min(half, 6)).join(' '));
  }
  return [...new Set(qs)].filter((q) => q.split(' ').length >= 2 || w.length === 1);
}

// يتحقق من حديث واحد. يعيد الحالة والأحكام ونتيجة كشف التحريف.
export async function checkHadith(quote) {
  const queries = searchQueries(quote);

  // 1) حسب فلو تبيّن: نبحث أولاً في HadeethEnc لأنه مصدر الأحاديث الثابتة.
  let hadeethEncSuccess = false;
  let hadeethAll = [];

  for (const q of queries) {
    try {
      const results = await searchHadeethEncAny(q);
      hadeethEncSuccess = true;
      hadeethAll = hadeethAll.concat(results || []);

      const pick = pickMatches(quote, hadeethAll);
      if (pick.best) {
        const seen = new Set();
        const matched = pick.matched.filter((m) => {
          const k = `${m.origin || ''}|${m.source}|${m.number}|${m.ruling}|${normalizeArabic(m.text).slice(0, 50)}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });

        const decision = decideStatus(matched);
        const stable = decision.judged.filter((j) => j.cat === 'ثابت');
        const ref = stable[0] || decision.judged[0];
        const d = ref ? { ...alignDiff(quote, ref.text), ref } : null;
        const diff = d ? { ...d, bad: d.userWords.filter((w) => !w.ok).length } : null;

        return {
          ...decision,
          status: 'ثابت',
          note: decision.note || 'ثابت في موسوعة الأحاديث النبوية (HadeethEnc).',
          diff,
          full: fullSource(quote, diff?.ref),
          score: pick.best.score,
        };
      }
    } catch {
      // نكمل بقية استعلامات HadeethEnc؛ الفشل التقني لا يعني أن الحديث غير ثابت.
    }
    await pause();
  }

  // 2) إذا لم نجد أصلاً ثابتاً في HadeethEnc ننتقل إلى محتوى الدرر السنية
  // عبر API الباحث الحديثي، وننقل أحكام المحدّثين دون ترجيح من الأداة.
  let dorarSuccess = false;
  let dorarAll = [];

  for (const q of queries) {
    try {
      const results = await searchFromBrowser(q);
      dorarSuccess = true;
      dorarAll = dorarAll.concat(results || []);

      const pick = pickMatches(quote, dorarAll);
      if (pick.best && pick.best.score >= 0.85) break;
    } catch {
      // نجرب بقية الاستعلامات قبل إعلان تعذر الوصول.
    }
    await pause();
  }

  if (!dorarSuccess) {
    return {
      status: 'تعذّر التحقق',
      note: hadeethEncSuccess
        ? 'لم يُعثر على أصل ثابت في HadeethEnc، وتعذّر الوصول إلى أحكام الدرر السنية الآن.'
        : 'تعذّر الوصول إلى HadeethEnc وإلى أحكام الدرر السنية الآن.',
      judged: [],
      diff: null,
    };
  }

  const pick = pickMatches(quote, dorarAll);
  if (!pick.best) {
    return {
      status: 'لم يُعثر عليه',
      note: 'لم تجد الأداة أصلاً مطابقاً بثقة كافية في المصادر المتاحة. هذا لا يعني أنه مكذوب.',
      judged: [],
      diff: null,
    };
  }

  const seen = new Set();
  const matched = pick.matched.filter((m) => {
    const k = `${m.origin || ''}|${m.muhaddith}|${m.source}|${m.number}|${m.ruling}|${normalizeArabic(m.text).slice(0, 50)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const decision = decideStatus(matched);
  const ref = decision.judged[0];
  const d = ref ? { ...alignDiff(quote, ref.text), ref } : null;
  const diff = d ? { ...d, bad: d.userWords.filter((w) => !w.ok).length } : null;

  return {
    ...decision,
    diff,
    full: fullSource(quote, diff?.ref),
    score: pick.best.score,
  };
}


// النص الطويل يُقسَّم إلى أجزاء عند حدود الفقرات (كل جزء حتى 6000 حرف)،
// ويُرسل كل جزء وحده، ثم تُعاد المواضع إلى مكانها في النص الكامل.
const CHUNK = 6000;
function chunks(text) {
  const out = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + CHUNK, text.length);
    if (end < text.length) {
      const cut = Math.max(text.lastIndexOf('\n', end), text.lastIndexOf('.', end), text.lastIndexOf('،', end));
      if (cut > start + CHUNK / 2) end = cut + 1;
    }
    out.push({ start, text: text.slice(start, end) });
    start = end;
  }
  return out;
}


export async function extract(text) {
  const parts = chunks(text).filter((c) => c.text.trim());
  const results = new Array(parts.length);
  let next = 0;
  const worker = async () => {
    while (next < parts.length) {
      const i = next++;
      results[i] = await post('/api/extract', { text: parts[i].text });
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, parts.length) }, worker));
  const items = [];
  let rejected = 0;
  let engine = 'ai';
  results.forEach((r, i) => {
    const off = parts[i].start;
    if (r.engine === 'rules') engine = 'rules';
    rejected += r.rejected || 0;
    for (const it of r.items) {
      const t = trimQuotes({ ...it, start: it.start + off, end: it.end + off });
      if (hasArabic(t.quote)) items.push(t); // الحديث نص عربي؛ ما سواه يُستبعد
    }
  });
  return { engine, items, rejected };
}

// تحليل النص كاملاً. يُبلَّغ بالمواضع فور استخراجها، ثم بكل حديث حين ينتهي فحصه،
// ويُفحص أكثر من حديث في الوقت نفسه لتقليل الانتظار.
export async function analyzeText(text, { onProgress = () => {}, onExtracted = () => {}, onItem = () => {}, concurrency = 3 } = {}) {
  onProgress('جارٍ تحديد الأحاديث في النص…');
  const { engine, items, rejected } = await extract(text);
  onExtracted(items, engine);
  const out = new Array(items.length);
  const memo = new Map(); // الحديث المكرر في النص يُفحص مرة واحدة
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      const it = items[i];
      try {
        const key = normalizeArabic(it.quote);
        if (!memo.has(key)) memo.set(key, checkHadith(it.quote));
        out[i] = { ...it, kind: 'hadith', ...(await memo.get(key)) };
      } catch {
        out[i] = { ...it, kind: 'hadith', status: 'تعذّر التحقق', note: 'تعذّر التحقق من هذا الحديث الآن.', judged: [], diff: null };
      }
      done++;
      onProgress(`تم التحقق من ${done} من ${items.length}…`);
      onItem(i, out[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { engine, rejected, items: out };
}


// بدائل ثابتة: النموذج يقترح كلمات بحث فقط، والنصوص تأتي من HadeethEnc.
export async function findAlternatives(quote) {
  const { queries } = await post('/api/alt-queries', { quote });
  const found = [];
  const seen = new Set();

  // البدائل تأتي من HadeethEnc فقط؛ النموذج لا يكتب حديثاً، بل يقترح كلمات البحث.
  for (const q of queries) {
    let res = [];
    try { res = await searchHadeethEncAny(q); } catch { continue; }

    for (const r of res) {
      const c = classifyRuling(r.ruling, r.source);
      if (c.cat !== 'ثابت' || c.level !== 'matn') continue;
      if (similarity(quote, r.text).score >= MATCH_THRESHOLD) continue;

      const part = excerpt(r.text, q);
      if (plain(part).length > MAX_ALT * 1.6) continue;
      const k = normalizeArabic(part).slice(0, 60);
      if (seen.has(k) || found.some((f) => similarity(f.text, part).score >= 0.8)) continue;

      seen.add(k);
      found.push({ ...r, text: part, partial: part !== r.text });
    }

    if (found.length >= 3) break;
    await pause();
  }

  return found.slice(0, 3);
}



export async function baseline(quote) {
  return post('/api/baseline', { quote });
}

// تحسين الصياغة حول التعديلات: يُرسَل كلام الكاتب وحده، ونص الحديث لا يعود من النموذج أصلاً.
export async function rephrase(text, spans, touched = []) {
  const plan = splitForRephrase(text, spans, touched);
  if (!plan.items.length) return { text, changed: 0, rejected: 0 };
  const { items } = await post('/api/rephrase', { items: plan.items });
  if (!Array.isArray(items) || items.length !== plan.items.length) throw new Error('أعاد النموذج نتيجة غير مكتملة، أعد المحاولة');
  return applyRephrase(plan, items);
}