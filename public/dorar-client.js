// الاتصال بالموسوعة الحديثية في الدرر السنية.
// المصدر هنا هو الدرر السنية فقط.
// نستخدم JSONP أولاً لأنها الطريقة الرسمية الموثقة من الدرر لأصحاب المواقع.
// إذا تعذر JSONP نجرب نفس الدرر عبر خادم تبيّن.
// لا يوجد fallback إلى الكتب الستة أو أي مصدر آخر.

import { parseDorarData } from '/lib/dorar.js';

const DORAR_ENDPOINTS = [
  'https://dorar.net/dorar_api.json',
  'https://www.dorar.net/dorar_api.json',
];

const JSONP_TIMEOUT = 12000;

/**
 * تنفيذ طلب JSONP حقيقي بدون fetch.
 * JSONP لا يعتمد على CORS لأن الطلب يُحمّل كـ <script>.
 */
function jsonpFrom(endpoint, query, timeoutMs = JSONP_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const callbackName =
      'tabayyunDorar' +
      Date.now().toString(36) +
      Math.random().toString(36).slice(2, 10);

    const script = document.createElement('script');

    let finished = false;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);

      try {
        delete window[callbackName];
      } catch {
        window[callbackName] = undefined;
      }

      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };

    const fail = (message) => {
      if (finished) return;

      finished = true;
      cleanup();
      reject(new Error(message));
    };

    window[callbackName] = (data) => {
      if (finished) return;

      finished = true;

      try {
        const results = parseDorarData(data);
        cleanup();
        resolve(Array.isArray(results) ? results : []);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    const params = new URLSearchParams({
      skey: query,
      callback: callbackName,
      _: String(Date.now()),
    });

    script.src = `${endpoint}?${params.toString()}`;

    // مهم: هذا JSONP وليس fetch.
    script.async = true;

    // لا نرسل Referrer الخاص بـ Render للدرر.
    script.referrerPolicy = 'no-referrer';

    script.onerror = () => {
      fail(`تعذر تحميل JSONP من ${endpoint}`);
    };

    timer = setTimeout(() => {
      fail(`انتهت مهلة JSONP من ${endpoint}`);
    }, timeoutMs);

    document.head.appendChild(script);
  });
}

/**
 * نجرب نطاق الدرر الأساسي أولاً ثم www.
 */
async function viaJsonp(query) {
  const errors = [];

  for (const endpoint of DORAR_ENDPOINTS) {
    try {
      const results = await jsonpFrom(endpoint, query);

      console.info('Dorar connection: JSONP');

      return results;
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  }

  throw new Error(errors.join(' | '));
}

/**
 * نفس مصدر الدرر، لكن الطلب يمر عبر Backend تبيّن.
 * هذه ليست قاعدة بديلة؛ المصدر ما زال dorar.net.
 */
async function viaServer(query) {
  const controller = new AbortController();

  const timer = setTimeout(() => {
    controller.abort();
  }, 12000);

  try {
    const response = await fetch(
      `/api/dorar?q=${encodeURIComponent(query)}`,
      {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: controller.signal,
      }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error || `Dorar server HTTP ${response.status}`
      );
    }

    console.info('Dorar connection: server');

    return Array.isArray(data.results) ? data.results : [];
  } finally {
    clearTimeout(timer);
  }
}


// فقط طريقتان للوصول إلى نفس المصدر: الدرر السنية.
const ROUTES = {
  jsonp: viaJsonp,
  server: viaServer,
};


// نحفظ طريقة الاتصال الناجحة مؤقتاً لتسريع الفحص التالي.
const STORAGE_KEY = 'tabayyun-dorar-route-v2';
const ROUTE_TTL = 10 * 60 * 1000;


function getRememberedRoute() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || '{}'
    );

    if (
      saved.name &&
      ROUTES[saved.name] &&
      saved.at &&
      Date.now() - saved.at < ROUTE_TTL
    ) {
      return saved.name;
    }
  } catch {
    // تجاهل مشاكل localStorage
  }

  return null;
}


function rememberRoute(name) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        name,
        at: Date.now(),
      })
    );
  } catch {
    // تجاهل مشاكل localStorage
  }
}


function forgetRoute() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // تجاهل
  }
}


let workingRoute = getRememberedRoute();
let probingPromise = null;


export const activeRoute = () => workingRoute;


/**
 * تجربة طرق الوصول إلى الدرر.
 *
 * إذا كان عندنا Route نجح سابقاً نجربه أولاً.
 * وإلا JSONP أولاً دائماً.
 */
async function tryRoutes(query) {
  const order = workingRoute
    ? [
        workingRoute,
        ...Object.keys(ROUTES).filter(
          (name) => name !== workingRoute
        ),
      ]
    : ['jsonp', 'server'];

  const errors = [];

  for (const name of order) {
    try {
      const results = await ROUTES[name](query);

      workingRoute = name;
      rememberRoute(name);

      console.info(`Dorar route: ${name}`);

      return results;
    } catch (error) {
      errors.push(
        `${name}: ${error?.message || String(error)}`
      );
    }
  }

  workingRoute = null;
  forgetRoute();

  console.error(
    'Dorar unreachable:',
    errors.join(' | ')
  );

  throw new Error(
    `تعذر الوصول إلى الدرر السنية. ${errors.join(' | ')}`
  );
}


/**
 * الدالة التي يستخدمها pipeline.js.
 */
export async function searchFromBrowser(query) {
  const cleanQuery = String(query || '').trim();

  if (!cleanQuery) {
    return [];
  }

  // إذا كان أول حديث في الصفحة يختبر الاتصال،
  // لا نجعل بقية الأحاديث تبدأ اختبارات متوازية لنفس الطرق.
  if (!workingRoute && probingPromise) {
    try {
      await probingPromise;
    } catch {
      // سيعيد الطلب الحالي المحاولة بنفسه.
    }
  }

  if (!workingRoute) {
    probingPromise = tryRoutes(cleanQuery);

    try {
      return await probingPromise;
    } finally {
      probingPromise = null;
    }
  }

  return tryRoutes(cleanQuery);
}