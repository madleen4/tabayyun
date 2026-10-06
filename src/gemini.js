// استدعاء نموذج Gemini من الخادم فقط (المفتاح لا يصل إلى المتصفح).
// النموذج لا يولّد نصوصاً شرعية: يحدد المواضع، ويقترح كلمات بحث، ويعيد صياغة الكلام المحيط.
import { locate } from './normalize.js';

const BASE = () => process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com';
// يمكن وضع أكثر من مفتاح مفصولة بفواصل في GEMINI_API_KEY: إذا نفدت حصة مفتاح، يُستخدم التالي.
const keys = () => String(process.env.GEMINI_API_KEY || '').split(',').map((k) => k.trim()).filter(Boolean);
const candidates = new Map();  // لكل مفتاح: النماذج المتاحة له، مرتبة بالأفضلية
const working = new Map();     // لكل مفتاح: آخر نموذج نجح
const restUntil = new Map();   // مفتاح نفدت حصته: لا يُجرَّب حتى هذا الوقت
let lastKey = null;            // آخر مفتاح نجح
const modelRest = new Map();   // «مفتاح|نموذج» نفدت حصته أو لم يعد متاحاً: لا يُجرَّب حتى هذا الوقت

function rank(n) {
  if (/^gemini-[\d.]+-flash$/.test(n)) return 0;                       // flash القياسي
  if (/flash/.test(n) && !/(lite|image|tts|audio|live|exp|preview|thinking|omni)/.test(n)) return 1;
  if (/flash-lite/.test(n)) return 2;
  if (/flash/.test(n)) return 3;
  return 4;
}

async function listModels(key, fetchImpl) {
  if (candidates.has(key)) return candidates.get(key);
  const res = await fetchImpl(`${BASE()}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  if (!res.ok) {
    const err = new Error(`Gemini list models HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const { models = [] } = await res.json();
  const usable = models
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /gemini/.test(n) && !/(image|tts|audio|live|embedding)/.test(n))
    .sort((a, b) => rank(a) - rank(b) || b.localeCompare(a, 'en', { numeric: true }));
  const wanted = process.env.GEMINI_MODEL;
  const list = wanted && usable.includes(wanted) ? [wanted, ...usable.filter((n) => n !== wanted)] : usable;
  if (!list.length) throw new Error('No Gemini model available for this key');
  candidates.set(key, list);
  return list;
}

export const hasKey = () => keys().length > 0;

async function callModel(key, model, prompt, json, timeoutMs, fetchImpl, image) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${BASE()}/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [...(image ? [{ inlineData: { mimeType: image.mime, data: image.data } }] : []), { text: prompt }] }],
        generationConfig: { temperature: 0, ...(json ? { responseMimeType: 'application/json' } : {}) },
      }),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 160).replace(/\s+/g, ' ');
      const err = new Error(`Gemini HTTP ${res.status} (${model}) ${detail}`);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    if (!json) return text;
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } finally {
    clearTimeout(timer);
  }
}

// يجرّب المفاتيح ثم النماذج المتاحة لكل مفتاح بالترتيب: إن نفدت حصة نموذج (429) أو لم يوجد (404)
// أو كان مزدحماً (503) أو تأخر، ينتقل للذي بعده. إذا نفدت حصة المفتاح كله، يُترك عشر دقائق وينتقل للمفتاح التالي.
// لا ينتقل إذا كان الخطأ في الطلب نفسه (400). budgetMs: أقصى وقت لكل المحاولات معاً.
export async function generate(prompt, { json = true, timeoutMs = 20000, budgetMs = 25000, fetchImpl = globalThis.fetch, image = null } = {}) {
  const all = keys();
  if (!all.length) throw new Error('NO_KEY');
  const deadline = Date.now() + budgetMs;
  const now = Date.now();
  let order = all.filter((k) => !(restUntil.get(k) > now));
  if (!order.length) order = all;
  if (lastKey && order.includes(lastKey)) order = [lastKey, ...order.filter((k) => k !== lastKey)];
  let lastErr;
  for (const key of order) {
    let list;
    try { list = await listModels(key, fetchImpl); } catch (err) { lastErr = err; continue; }
    const w = working.get(key);
    const fresh = list.filter((m) => !(modelRest.get(`${key}|${m}`) > Date.now()));
    const models = (w ? [w, ...fresh.filter((m) => m !== w)] : fresh).slice(0, 10);
    let quota = 0;
    for (const model of models) {
      const left = deadline - Date.now();
      if (left < 1500) throw lastErr || new Error('Gemini time budget exceeded');
      try {
        const out = await callModel(key, model, prompt, json, Math.min(timeoutMs, left), fetchImpl, image);
        if (working.get(key) !== model || lastKey !== key) console.log(`Gemini model: ${model} (key ${all.indexOf(key) + 1} of ${all.length})`);
        working.set(key, model);
        lastKey = key;
        return out;
      } catch (err) {
        lastErr = err;
        if (err.status === 400) throw err;
        if (err.status === 401 || err.status === 403) break; // مفتاح غير صالح: المفتاح التالي
        if (err.status === 429) { quota++; modelRest.set(`${key}|${model}`, Date.now() + 10 * 60_000); }
        if (err.status === 404) modelRest.set(`${key}|${model}`, Date.now() + 24 * 3600_000); // نموذج لم يعد متاحاً
        if (working.get(key) === model) working.delete(key);
      }
    }
    if (quota >= 2 && quota === models.length) restUntil.set(key, Date.now() + 10 * 60_000);
  }
  throw lastErr || new Error('Gemini time budget exceeded');
}

const EXTRACT_PROMPT = (text) => `أنت أداة استخراج. مهمتك تحديد الأقوال المنسوبة إلى النبي ﷺ في النص التالي فقط.

القواعد:
- انسخ نص كل قول حرفياً كما ورد في المدخل، دون تصحيح أو تشكيل أو إكمال، ودون عبارة النسبة نفسها (مثل: قال رسول الله ﷺ).
- لا تضف أي قول غير موجود في النص، ولا تحكم على صحته.
- إذا كان المنسوب إلى النبي ﷺ آية قرآنية، فاجعل kind = "quran" واذكر رقم السورة والآية. وإلا kind = "hadith" وsura وaya = null.
- إذا لم يوجد أي قول منسوب، أعد قائمة فارغة.

أعد JSON فقط بهذا الشكل:
{"items":[{"quote":"...","kind":"hadith","sura":null,"aya":null}]}

النص:
"""
${text}
"""`;

// يعيد مواضع الأقوال داخل النص الأصلي، ويستبعد أي قول لا يوجد حرفياً في النص.
export async function extractWithAI(text, opts) {
  const out = await generate(EXTRACT_PROMPT(text), { budgetMs: 40000, timeoutMs: 30000, ...opts });
  const items = [];
  let rejected = 0;
  let cursor = 0;
  for (const it of out?.items || []) {
    const quote = String(it.quote || '').trim();
    if (!quote) continue;
    const pos = locate(text, quote, cursor) || locate(text, quote, 0);
    if (!pos) { rejected++; continue; } // مقاومة الهلوسة: ما ليس في النص يُرفض
    cursor = pos.end;
    items.push({
      quote: text.slice(pos.start, pos.end),
      start: pos.start,
      end: pos.end,
      kind: it.kind === 'quran' ? 'quran' : 'hadith',
      sura: it.sura ?? null,
      aya: it.aya ?? null,
    });
  }
  return { items, rejected };
}

export async function altQueriesWithAI(quote, opts) {
  const prompt = `القول التالي حُكم عليه بالضعف أو الوضع: «${quote}».
اقترح أربع عبارات قصيرة (من 3 إلى 6 كلمات) هي مقاطع حرفية من أحاديث صحيحة مشهورة في المعنى نفسه أو قريب منه،
كما وردت بلفظها في صحيح البخاري أو صحيح مسلم أو السنن، لنبحث بها في هذه الكتب.
اكتب المقطع بلفظ الحديث نفسه دون «قال رسول الله»، ودون ذكر حكم أو مصدر. إن لم تعرف لفظاً صحيحاً فلا تخترع.
أعد JSON فقط: {"queries":["...","...","...","..."]}`;
  const out = await generate(prompt, opts);
  return (out?.queries || []).map((q) => String(q).trim()).filter(Boolean).slice(0, 4);
}

// يستقبل فقرات (فيها رموز ⟦n⟧ مكان الأحاديث) ويعيدها بالعدد نفسه بعد إصلاح ما انكسر من صياغتها.
export async function rephraseWithAI(items, opts) {
  const prompt = `أنت محرر لغوي لمنشور دعوي. عُدِّل فيه حديث (استُبدل بلفظ صحيح أو بحديث آخر) أو حُذف منه قول لا يصح، فقد لا يتصل الكلام المحيط بالتعديل.
كل عنصر فقرة مقسومة إلى: parts (كلام الكاتب) وquotes (أحاديث ثابتة لا تُمس).
الفقرة الكاملة = parts[0] + quotes[0] + parts[1] + quotes[1] + ... + parts[الأخير].
المطلوب: أعد كتابة parts فقط ليستقيم الكلام ويناسب معنى الأحاديث كما هي الآن:
- لا تكتب نص أي حديث، ولا تضف حديثاً أو آية أو نسبة جديدة إلى النبي ﷺ، ولا علامات تنصيص جديدة.
- أبقِ علامات التنصيص « » الملاصقة للأحاديث في مكانها.
- إذا بقيت عبارة نسبة بلا قول بعدها (مثل «قال رسول الله ﷺ:» في آخر الجزء ولا حديث بعده)، فاحذفها.
- إذا لم يعد كلام الكاتب مناسباً لمعنى الحديث الجديد، فعدّله ليناسبه.
- اجعل التعديل في أضيق حد، وإن كان الجزء سليماً فأعده كما هو حرفياً.
أعد JSON فقط بنفس عدد العناصر ونفس عدد الأجزاء في كل عنصر: {"items":[{"parts":["...","..."]}]}

العناصر:
${JSON.stringify(items)}`;
  const out = await generate(prompt, opts);
  return (out?.items || []).map((it) => ({ parts: (it?.parts || []).map((p) => String(p)) }));
}

// للمقارنة المرجعية فقط: كيف يجيب نموذج عام بلا مصادر.
export async function baselineWithAI(quote, opts) {
  const prompt = `هل هذا حديث صحيح؟ اذكر حكمه ومصدره ورقمه باختصار: «${quote}»`;
  return generate(prompt, { ...opts, json: false });
}

// قراءة النص من صورة (لقطة شاشة لمنشور أو رسالة). يُنسخ النص حرفياً دون تصحيح ولا إضافة.
export async function ocrWithAI(image, opts) {
  const prompt = `انسخ النص العربي الظاهر في هذه الصورة أو هذا المستند حرفياً كما هو، بترتيب قراءته الصحيح من اليمين إلى اليسار.
- لا تصحح الأخطاء ولا تكمل الناقص ولا تضف شيئاً من عندك.
- احتفظ بعلامات التنصيص والرموز مثل ﷺ كما تظهر.
- تجاهل عناصر الواجهة (الوقت، أزرار الإعجاب، أسماء الحسابات) إن لم تكن جزءاً من المنشور.
أعد النص فقط دون أي شرح. إن لم يكن في الصورة نص، أعد سطراً فارغاً.`;
  const out = await generate(prompt, { ...opts, json: false, image, timeoutMs: 60000, budgetMs: 75000 });
  return String(out || '').trim();
}