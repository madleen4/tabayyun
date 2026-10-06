// الاتصال المباشر بالموسوعة الحديثية في الدرر السنية من متصفح المستخدم.
// نبدأ بـ JSONP لأنها الطريقة التي توثقها الدرر لأصحاب المواقع، ثم نحاول الطرق الأخرى.
// لا يوجد أي مصدر احتياطي يغيّر حكم الحديث إذا تعذّرت الدرر.
import { searchDorar, dorarApiUrl, parseDorarData } from '/lib/dorar.js';

function jsonp(query, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    // اسم من حروف فقط لتوافق أفضل مع خدمة JSONP القديمة.
    const cb = 'tabayyun' + Array.from({ length: 10 }, () => 'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)]).join('');
    const script = document.createElement('script');
    let done = false;
    let timer;

    const cleanup = () => {
      try { delete window[cb]; } catch { window[cb] = undefined; }
      script.remove();
      if (timer) clearTimeout(timer);
    };

    const fail = (message) => {
      if (done) return;
      done = true;
      cleanup();
      reject(new Error(message));
    };

    window[cb] = (data) => {
      if (done) return;
      done = true;
      cleanup();
      try {
        resolve(parseDorarData(data));
      } catch (e) {
        reject(e);
      }
    };

    script.onerror = () => fail('Dorar JSONP load error');
    timer = setTimeout(() => fail('Dorar JSONP timeout'), timeoutMs);
    script.src = `${dorarApiUrl(query)}&callback=${cb}`;
    document.head.append(script);
  });
}

async function viaServer(query) {
  const res = await fetch(`/api/dorar?q=${encodeURIComponent(query)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Dorar server ${res.status}`);
  return data.results || [];
}

const ROUTES = {
  jsonp: (q) => jsonp(q),
  direct: (q) => searchDorar(q),
  server: viaServer,
};

// نحفظ طريقة الدرر التي نجحت 15 دقيقة فقط لتقليل التأخير.
const KEY = 'tabayyun-dorar-route';
function remembered() {
  try {
    const { name, at } = JSON.parse(localStorage.getItem(KEY) || '{}');
    return ROUTES[name] && Date.now() - at < 15 * 60_000 ? name : null;
  } catch {
    return null;
  }
}
function remember(name) {
  try { localStorage.setItem(KEY, JSON.stringify({ name, at: Date.now() })); } catch { /* ignore */ }
}

let working = remembered();
let probing = null;

export const activeRoute = () => working;

async function tryRoutes(query) {
  const order = working
    ? [working, ...Object.keys(ROUTES).filter((k) => k !== working)]
    : Object.keys(ROUTES);
  const errors = [];

  for (const name of order) {
    try {
      const results = await ROUTES[name](query);
      working = name;
      remember(name);
      if (name !== order[0]) console.info(`Dorar route: ${name}`);
      return results;
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }

  working = null;
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