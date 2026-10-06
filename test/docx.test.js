// ملف Word الناتج: أرشيف صالح فيه نص المستخدم من اليمين لليسار.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDocx } from '../public/docx.js';

test('ملف Word صالح ويحوي النص والمصادر من اليمين لليسار', async () => {
  const blob = makeDocx([{ type: 'p', text: 'طلب العلم من أعظم القربات & <الأدب>.' }, { type: 'gap' }, { type: 'p', text: '- «الدين النصيحة» أخرجه مسلم في صحيحه (196).' }]);
  const buf = Buffer.from(await blob.arrayBuffer());
  assert.equal(buf.readUInt32LE(0), 0x04034b50);                 // بداية أرشيف zip
  assert.equal(buf.readUInt32LE(buf.length - 22), 0x06054b50);   // نهاية الأرشيف
  assert.equal(buf.readUInt16LE(buf.length - 22 + 10), 3);       // ثلاثة ملفات
  const xml = buf.toString('utf8');
  assert.ok(xml.includes('word/document.xml'));
  assert.ok(xml.includes('طلب العلم من أعظم القربات &amp; &lt;الأدب&gt;.'));
  assert.ok(xml.includes('«الدين النصيحة»'));
  assert.ok(xml.includes('<w:bidi/>'));
});
