// الاتصال بالدرر من متصفح المستخدم.
import { searchDorar, dorarApiUrl, parseDorarHtml } from '/lib/dorar.js';

function jsonp(query, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    // اسم من حروف فقط، لأن خدمة الدرر قد تحذف الرموز والأرقام من اسم الدالة.
    const cb = 'tabayyun' + Array.from({ length: 8 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('');
    const script = document.createElement('script');
    let done = false;
    const cleanup = () => { delete window[cb]; script.remove(); clearTimeout(timer); };
    const timer = setTimeout(() => { if (!done) { cleanup(); reject(new Error('JSONP timeout')); } }, timeoutMs);
    window[cb] = (data) => { done = true; cleanup(); resolve(parseDorarHtml(data?.ahadith?.result ?? '')); };
    script.onerror = () => { if (!done) { cleanup(); reject(new Error('JSONP load error (blocked or failed to load)')); } };
    // إن حُمّل الملف ولم يُستدعَ الرد، فالخدمة لا تدعم JSONP.
    script.onload = () => setTimeout(() => { if (!done) { cleanup(); reject(new Error('JSONP not supported')); } }, 50);
    script.src = `${dorarApiUrl(query)}&callback=${cb}`;
    document.head.append(script);
  });
}

// أربع طرق بالترتيب، وتُحفظ الطريقة الناجحة لبقية الجلسة:
// 1) الدرر عبر خادم تبيَّن، 2) JSONP كما توثّقها الدرر (dorar.net/article/389)، 3) قراءة مباشرة،
// 4) المصدر الاحتياطي: كتب السنة من مجموعة بيانات مفتوحة محفوظة في الخادم.
async function viaServer(query) {
  const res = await fetch(`/api/dorar?q=${encodeURIComponent(query)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `server ${res.status}`);
  return data.results;
}

async function viaLocal(query) {
  const res = await fetch(`/api/local?q=${encodeURIComponent(query)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `local ${res.status}`);
  return data.results;
}

const ROUTES = { server: viaServer, jsonp: (q) => jsonp(q), direct: (q) => searchDorar(q), local: viaLocal };

// تُحفظ الطريقة الناجحة 15 دقيقة، حتى لا تُجرَّب الطرق المرفوضة مع كل فتح للصفحة.
const KEY = 'tabayyun-route';
function remembered() {
  try {
    const { name, at } = JSON.parse(localStorage.getItem(KEY) || '{}');
    return ROUTES[name] && Date.now() - at < 15 * 60_000 ? name : null;
  } catch { return null; }
}
function remember(name) {
  try { localStorage.setItem(KEY, JSON.stringify({ name, at: Date.now() })); } catch { /* التخزين غير متاح */ }
}
let working = remembered();
let probing = null; // أول بحث يجرّب الطرق، والبقية تنتظر نتيجته بدل أن تجرّب كلها معاً

export const activeRoute = () => working;

async function tryRoutes(query) {
  const order = working ? [working, ...Object.keys(ROUTES).filter((k) => k !== working)] : Object.keys(ROUTES);
  const errors = [];
  for (const name of order) {
    try {
      const results = await ROUTES[name](query);
      if (working !== name) console.info(`Dorar route: ${name}`);
      working = name;
      remember(name);
      return results;
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  console.error('Dorar unreachable:', errors.join(' | '));
  throw new Error(errors.join(' | '));
}

export async function searchFromBrowser(query) {
  if (!working && probing) await probing.catch(() => {});
  if (!working) {
    probing = tryRoutes(query);
    try { return await probing; } finally { probing = null; }
  }
  return tryRoutes(query);
}