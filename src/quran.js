// التحقق من الآيات عبر موسوعة القرآن الكريم (quranenc.com) التابعة للجمعية.
// النموذج يقترح السورة والآية فقط، والنص يُؤخذ من المصدر ويُتحقق منه آلياً.
import { normalizeArabic } from './normalize.js';

export const SURAS = ['الفاتحة', 'البقرة', 'آل عمران', 'النساء', 'المائدة', 'الأنعام', 'الأعراف', 'الأنفال', 'التوبة', 'يونس',
  'هود', 'يوسف', 'الرعد', 'إبراهيم', 'الحجر', 'النحل', 'الإسراء', 'الكهف', 'مريم', 'طه',
  'الأنبياء', 'الحج', 'المؤمنون', 'النور', 'الفرقان', 'الشعراء', 'النمل', 'القصص', 'العنكبوت', 'الروم',
  'لقمان', 'السجدة', 'الأحزاب', 'سبأ', 'فاطر', 'يس', 'الصافات', 'ص', 'الزمر', 'غافر',
  'فصلت', 'الشورى', 'الزخرف', 'الدخان', 'الجاثية', 'الأحقاف', 'محمد', 'الفتح', 'الحجرات', 'ق',
  'الذاريات', 'الطور', 'النجم', 'القمر', 'الرحمن', 'الواقعة', 'الحديد', 'المجادلة', 'الحشر', 'الممتحنة',
  'الصف', 'الجمعة', 'المنافقون', 'التغابن', 'الطلاق', 'التحريم', 'الملك', 'القلم', 'الحاقة', 'المعارج',
  'نوح', 'الجن', 'المزمل', 'المدثر', 'القيامة', 'الإنسان', 'المرسلات', 'النبأ', 'النازعات', 'عبس',
  'التكوير', 'الانفطار', 'المطففين', 'الانشقاق', 'البروج', 'الطارق', 'الأعلى', 'الغاشية', 'الفجر', 'البلد',
  'الشمس', 'الليل', 'الضحى', 'الشرح', 'التين', 'العلق', 'القدر', 'البينة', 'الزلزلة', 'العاديات',
  'القارعة', 'التكاثر', 'العصر', 'الهمزة', 'الفيل', 'قريش', 'الماعون', 'الكوثر', 'الكافرون', 'النصر',
  'المسد', 'الإخلاص', 'الفلق', 'الناس'];

export async function verifyAyah(quote, sura, aya, { fetchImpl = globalThis.fetch } = {}) {
  sura = Number(sura); aya = Number(aya);
  if (!(sura >= 1 && sura <= 114 && aya >= 1 && aya <= 286)) return { verified: false };
  const url = `https://quranenc.com/api/v1/translation/aya/arabic_moyassar/${sura}/${aya}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetchImpl(url, { signal: ctrl.signal });
    if (!res.ok) return { verified: false };
    const data = await res.json();
    const ayahText = data?.result?.arabic_text || '';
    const a = normalizeArabic(ayahText);
    const q = normalizeArabic(quote);
    const ok = Boolean(a && q) && (a.includes(q) || q.includes(a));
    return ok
      ? { verified: true, sura, aya, suraName: SURAS[sura - 1], ayahText, source: url }
      : { verified: false };
  } catch {
    return { verified: false };
  } finally {
    clearTimeout(timer);
  }
}
