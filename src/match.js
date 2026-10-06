// مطابقة نص المستخدم بنص المصدر، وكشف التحريف بمقارنة آلية (لا ذكاء اصطناعي).
import { normalizeArabic } from './normalize.js';

export const MATCH_THRESHOLD = 0.6;

// يقسم النص الأصلي إلى كلمات، ويحفظ لكل كلمة صورتها المطبّعة وموضعها الأصلي.
export function tokenize(text = '') {
  const orig = String(text).split(/\s+/).filter(Boolean);
  const tokens = [];
  orig.forEach((o, i) => {
    const n = normalizeArabic(o);
    if (n) for (const part of n.split(' ')) tokens.push({ n: part, origIndex: i });
  });
  return { orig, tokens };
}

// «الكلمة» و«والكلمة» كلمة واحدة: واو العطف في أول الكلمة لا تُعد اختلافاً في اللفظ.
const same = (x, y) => x === y || (x.length > 2 && y.length > 2 && (`و${x}` === y || x === `و${y}`));

function lcs(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));
  for (let i = m - 1; i >= 0; i--)
    for (let j = n - 1; j >= 0; j--)
      dp[i][j] = same(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const pairs = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (same(a[i], b[j])) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

// درجة التشابه: الكلمات المشتركة بالترتيب ÷ طول الأقصر، داخل أفضل مقطع متصل من المصدر.
// الكلمات يجب أن تكون متقاربة في المصدر، لا متفرقة في نص طويل
// (مثلاً «أمتي» في جملة و«رحمة» في جملة بعدها ليستا تطابقاً لـ«اختلاف أمتي رحمة»).
function windowScore(q, win, shorter) {
  const pairs = lcs(q, win);
  const common = pairs.length;
  if (!common) return { score: 0, common: 0 };
  const span = pairs[common - 1][1] - pairs[0][1] + 1;
  return { score: (common / shorter) * Math.min(1, (common + 2) / span), common };
}

export function similarity(quote, source) {
  const q = tokenize(quote).tokens.map((t) => t.n);
  const s = tokenize(source).tokens.map((t) => t.n);
  const shorter = Math.min(q.length, s.length);
  if (shorter < 2) return { score: 0, common: 0 };
  const W = q.length + 4;
  if (s.length <= W) return windowScore(q, s, shorter);
  let best = { score: 0, common: 0 };
  for (let st = 0; st <= s.length - W; st++) {
    const r = windowScore(q, s.slice(st, st + W), shorter);
    if (r.score > best.score) best = r;
    if (best.score >= 1) break;
  }
  return best;
}

// يقارن لفظ المستخدم بلفظ المصدر:
// - userWords: كلمات المستخدم، وكل كلمة معلَّمة ok=true إن وُجدت في المصدر بنفس الترتيب.
// - sourceWindow: المقطع المقابل من المصدر بلفظه الأصلي (مع التشكيل).
// - distorted: هل في لفظ المستخدم كلمات ليست في المصدر.
export function alignDiff(quote, source) {
  const Q = tokenize(quote);
  const S = tokenize(source);
  const qn = Q.tokens.map((t) => t.n);
  const sn = S.tokens.map((t) => t.n);
  const pairs = lcs(qn, sn);
  const okQ = new Set(pairs.map(([i]) => i));
  if (!pairs.length) return { userWords: Q.orig.map((w) => ({ w, ok: false })), sourceWindow: '', distorted: false };

  let sFirst = pairs[0][1], sLast = pairs[pairs.length - 1][1];
  const qFirst = pairs[0][0], qLast = pairs[pairs.length - 1][0];
  // كلمات غير مطابقة في طرفي نص المستخدم تقابل كلمات في طرفي المصدر (استبدال)
  sFirst = Math.max(0, sFirst - qFirst);
  sLast = Math.min(sn.length - 1, sLast + (qn.length - 1 - qLast));

  const startO = S.tokens[sFirst].origIndex;
  const endO = S.tokens[sLast].origIndex;
  const sourceWindow = S.orig.slice(startO, endO + 1).join(' ').replace(/[\s.،,؛:]+$/, '').trim();

  // علّم كلمات المستخدم الأصلية
  const badOrig = new Set();
  Q.tokens.forEach((t, i) => { if (!okQ.has(i)) badOrig.add(t.origIndex); });
  const userWords = Q.orig.map((w, i) => ({ w, ok: !badOrig.has(i) }));
  const distorted = Q.tokens.some((_, i) => !okQ.has(i));
  return { userWords, sourceWindow, distorted };
}

// يختار أفضل نتيجة ويجمع النتائج التي تخص الحديث نفسه.
export function pickMatches(quote, results, threshold = MATCH_THRESHOLD) {
  const scored = results
    .map((r) => ({ ...r, ...similarity(quote, r.text) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < threshold) return { best: null, matched: [], scored };
  return { best, matched: scored.filter((r) => r.score >= threshold), scored };
}

// مقطع من نص طويل (مثل حديث بإسناده) حول موضع التطابق، لعرضه مختصراً.
export function snippet(quote, source, before = 8, after = 20) {
  const Q = tokenize(quote).tokens.map((t) => t.n);
  const S = tokenize(source);
  const pairs = lcs(Q, S.tokens.map((t) => t.n));
  if (!pairs.length) return { text: source, truncated: false };
  const first = S.tokens[pairs[0][1]].origIndex;
  const last = S.tokens[pairs[pairs.length - 1][1]].origIndex;
  const from = Math.max(0, first - before);
  const to = Math.min(S.orig.length, last + 1 + after);
  const text = S.orig.slice(from, to).join(' ');
  const truncated = from > 0 || to < S.orig.length;
  return { text: (from > 0 ? '… ' : '') + text + (to < S.orig.length ? ' …' : ''), truncated };
}
