// قراءة ملفات Word وPDF داخل المتصفح (لا يُرفع الملف إلى أي خادم).
// الصور: تُصغَّر في المتصفح ثم يُقرأ نصها بالنموذج اللغوي عبر الخادم، ولا تُحفظ.
const MAMMOTH = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js';
const PDFJS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const PDFJS_WORKER = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

import { repairPdfArabic, looksGarbledPdf, orderPdfItems } from '/lib/text-ops.js';

const loaded = {};
function loadScript(src) {
  if (!loaded[src]) {
    loaded[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('تعذّر تحميل قارئ الملفات'));
      document.head.append(s);
    });
  }
  return loaded[src];
}

export async function readUploadedFile(file) {
  if (file.size > 50 * 1024 * 1024) throw new Error('الملف أكبر من 50 ميجابايت');
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  if (name.endsWith('.docx')) {
    await loadScript(MAMMOTH);
    const { value } = await window.mammoth.extractRawText({ arrayBuffer: buf });
    return { text: value.trim() };
  }
  if (name.endsWith('.pdf')) {
    await loadScript(PDFJS);
    const lib = window.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    const pdf = await lib.getDocument({ data: buf }).promise;
    const pages = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const content = await (await pdf.getPage(p)).getTextContent();
      pages.push(orderPdfItems(content.items.map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5] }))));
    }
    const raw = pages.join('\n');
    const fixed = repairPdfArabic(raw).trim();
    if (!looksGarbledPdf(raw)) return { text: fixed };
    // حروف معكوسة أو مفككة: يُقرأ الملف بالنموذج اللغوي كما يقرأ الصور، وإلا يُستخدم النص بعد إصلاح ما يمكن
    if (file.size <= 14 * 1024 * 1024) {
      try {
        return { text: await ocr('application/pdf', toBase64(buf)), note: 'قُرئ الملف بالذكاء الاصطناعي لأن حروفه في PDF غير سليمة. راجع النص ثم اضغط «تحقّق».' };
      } catch { /* يكمل بالنص المُصلح */ }
    }
    return { text: fixed, note: 'بعض حروف هذا الـPDF قد تظهر غير سليمة. للحصول على أدق نتيجة: ارفع ملف Word أو الصق النص.' };
  }
  if (/\.(png|jpe?g|webp)$/.test(name) || file.type.startsWith('image/')) return { text: await readImage(file) };
  throw new Error('الصيغ المدعومة: Word وPDF والصور');
}

// تصغير الصورة (أقصى بُعد 2000 بكسل) لتسريع الرفع، ثم إرسالها لقراءة نصها.
async function readImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const data = canvas.toDataURL('image/jpeg', 0.9).split(',')[1];
  return ocr('image/jpeg', data);
}

async function ocr(mime, data) {
  const res = await fetch('/api/ocr', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mime, data }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || 'تعذّرت القراءة');
  if (!out.text) throw new Error('لم يُعثر على نص');
  return out.text;
}

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}