// تشغيل مجموعة الاختبار على خط المعالجة الكامل، وحساب المقاييس.
import { analyzeText, baseline } from '/pipeline.js';

const $ = (id) => document.getElementById(id);
let report = [];

function td(text, cls = '') {
  const c = document.createElement('td');
  c.textContent = text;
  if (cls) c.className = cls;
  return c;
}
const expectedLabel = (c) => (c.expected_status == null ? 'لا أحاديث' : [].concat(c.expected_status).join(' أو '));
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

async function loadCases() {
  return (await (await fetch('/cases.json')).json()).cases;
}

$('run').addEventListener('click', async () => {
  $('run').disabled = true;
  $('rows').replaceChildren();
  report = [];
  const cases = await loadCases();
  for (const [i, c] of cases.entries()) {
    $('status').textContent = `جارٍ اختبار ${i + 1} من ${cases.length}…`;
    const t0 = performance.now();
    let row;
    try {
      const { items, engine } = await analyzeText(c.input);
      const secs = (performance.now() - t0) / 1000;
      const first = items[0];
      const got = first ? first.status : null;
      const countOk = items.length === c.expected_count;
      const accepted = [].concat(c.expected_status);
      const statusOk = c.expected_count === 0 ? items.length === 0 : accepted.includes(got);
      const distortionOk = c.expected_distortion ? Boolean(first?.diff?.distorted) : true;
      row = { ...c, got, gotCount: items.length, countOk, statusOk, distortionOk, secs, engine, distorted: Boolean(first?.diff?.distorted) };
    } catch (e) {
      row = { ...c, got: `خطأ: ${e.message}`, gotCount: 0, countOk: false, statusOk: false, distortionOk: false, secs: (performance.now() - t0) / 1000 };
    }
    report.push(row);
        // الخطة المجانية تسمح بنحو 15 طلباً في الدقيقة: مهلة قصيرة بين الحالات حتى لا يتوقف الذكاء الاصطناعي
    if (row.engine === 'ai' && i < cases.length - 1) await new Promise((r) => setTimeout(r, 4500));
    const tr = document.createElement('tr');
    const ok = row.statusOk && row.countOk && row.distortionOk;
    tr.append(td(c.id), td(c.type), td(c.input), td(expectedLabel(c)),
      td(`${row.got ?? 'لا أحاديث'}${row.distorted ? ' + تحريف' : ''} (${row.gotCount})${row.engine === 'rules' ? ' · دون ذكاء اصطناعي' : ''}`),
      td(ok ? 'نعم' : (c.requires === 'ai' && row.engine === 'rules' ? 'يحتاج الذكاء الاصطناعي' : 'لا'), ok ? 'ok' : 'no'), td(`${row.secs.toFixed(1)} ث`));
    $('rows').append(tr);
  }
  const n = report.length;
  const extraction = report.filter((r) => r.countOk).length;
  const status = report.filter((r) => r.statusOk).length;
  const abst = report.filter((r) => r.expected_status === 'لم يُعثر عليه');
  const abstOk = abst.filter((r) => r.statusOk).length;
  const wrongJudgment = report.filter((r) => r.expected_status === 'لم يُعثر عليه' && r.got && r.got !== 'لم يُعثر عليه').length;
  const avg = report.reduce((s, r) => s + r.secs, 0) / n;
  $('metrics').replaceChildren(...[
    `دقة الاستخراج: ${pct(extraction, n)}`,
    `دقة الحالة: ${pct(status, n)}`,
    `الامتناع الصحيح: ${pct(abstOk, abst.length)}`,
    `أحكام على نص لا أصل له: ${wrongJudgment}`,
    `متوسط الزمن: ${avg.toFixed(1)} ث`,
  ].map((t) => { const s = document.createElement('span'); s.className = 'chip'; s.textContent = t; return s; }));
  const noAi = report.some((r) => r.engine === 'rules');
  $('status').textContent = `اكتمل الاختبار: ${n} حالة. ألفاظ الأحاديث والأحكام المعروضة منقولة من المصدر، فنسبة الاختلاق صفر بحكم التصميم.${noAi ? ' تنبيه: الذكاء الاصطناعي لم يعمل في بعض الحالات، فاستُخدم الاستخراج بالقواعد.' : ''}`;
  $('md').disabled = false;
  $('run').disabled = false;
});

$('md').addEventListener('click', async () => {
  const lines = ['| # | النوع | المتوقع | النتيجة | تطابق | الزمن |', '| --- | --- | --- | --- | --- | --- |'];
  for (const r of report) {
    const ok = r.statusOk && r.countOk && r.distortionOk;
    lines.push(`| ${r.id} | ${r.type} | ${expectedLabel(r)} | ${r.got ?? 'لا أحاديث'}${r.distorted ? ' + تحريف' : ''} | ${ok ? 'نعم' : 'لا'} | ${r.secs.toFixed(1)} ث |`);
  }
  lines.push('', [...$('metrics').children].map((c) => `- ${c.textContent}`).join('\n'));
  await navigator.clipboard.writeText(lines.join('\n'));
  $('status').textContent = 'نُسخت النتائج. الصقها في README.';
});

$('base').addEventListener('click', async () => {
  $('base').disabled = true;
  const box = $('baseRows');
  box.replaceChildren();
  const cases = (await loadCases()).filter((c) => c.expected_count > 0);
  for (const [i, c] of cases.entries()) {
    $('status').textContent = `مقارنة ${i + 1} من ${cases.length}…`;
    const card = document.createElement('article');
    card.className = 'card';
    const h = document.createElement('h4');
    h.textContent = `${c.id} · ${c.type} · المتوقع: ${expectedLabel(c)}`;
    const q = document.createElement('p'); q.className = 'quote'; q.textContent = c.input;
    const a = document.createElement('p'); a.className = 'note';
    try { a.textContent = `جواب النموذج العام: ${(await baseline(c.input)).answer}`; }
    catch (e) { a.textContent = `تعذّر: ${e.message}`; }
    card.append(h, q, a);
    box.append(card);
  }
  $('status').textContent = 'راجع أجوبة النموذج العام يدوياً: هل نسب حكماً أو مصدراً أو رقماً غير صحيح؟';
  $('base').disabled = false;
});
