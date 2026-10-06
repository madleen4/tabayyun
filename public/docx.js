// إنشاء ملف Word (docx) داخل المتصفح دون مكتبات: ملف docx هو أرشيف zip فيه ملفات XML.

const enc = new TextEncoder();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- zip بلا ضغط ----------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of files) {
    const nameB = enc.encode(name);
    const data = enc.encode(text);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameB.length, true);
    parts.push(local, nameB, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, data.length, true);
    cen.setUint32(24, data.length, true);
    cen.setUint16(28, nameB.length, true);
    cen.setUint32(42, offset, true);
    central.push(cen, nameB);
    offset += 30 + nameB.length + data.length;
  }
  const size = central.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

// ---------- محتوى المستند ----------
// فقرة من اليمين لليسار. runs: [{ text, bold, color, size }]
function para(runs, { size = 28, after = 160, heading = false } = {}) {
  const r = (Array.isArray(runs) ? runs : [{ text: runs }]).map((x) => {
    const sz = (x.size || size) * 1;
    const props = `<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${x.bold || heading ? '<w:b/><w:bCs/>' : ''}${x.color ? `<w:color w:val="${x.color}"/>` : ''}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/><w:rtl/>`;
    return `<w:r><w:rPr>${props}</w:rPr><w:t xml:space="preserve">${esc(x.text)}</w:t></w:r>`;
  }).join('');
  return `<w:p><w:pPr><w:bidi/><w:spacing w:after="${after}" w:line="360" w:lineRule="auto"/></w:pPr>${r}</w:p>`;
}

// blocks: [{ type: 'h' | 'p', runs | text }]
export function makeDocx(blocks) {
  const body = blocks.map((b) => {
    if (b.type === 'h') return para([{ text: b.text, color: '1E4636' }], { size: 32, after: 200, heading: true });
    if (b.type === 'gap') return para('', { after: 120 });
    return para(b.runs || b.text, { size: b.size || 28 });
  }).join('');
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1300" w:right="1300" w:bottom="1300" w:left="1300" w:header="700" w:footer="700" w:gutter="0"/><w:bidi/></w:sectPr></w:body></w:document>`;
  return zip([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/document.xml', doc],
  ]);
}

export function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}