/* 解码第 1 页内容流：找标题附近的 Tf（字体）/ rg（颜色）/ Tm（位置）序列 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const V = path.join(__dirname, '..', 'renderer', 'vendor');
const PDFLib = require(path.join(V, 'pdf-lib.min.js'));

(async () => {
  const bytes = fs.readFileSync('C:/Users/Administrator/Desktop/苏M34412-2026年工程机械保单.pdf');
  const doc = await PDFLib.PDFDocument.load(bytes);
  const page = doc.getPages()[0];

  // 取内容流原始字节（可能是数组多个流，且带 FlateDecode）
  const raws = [];
  const cont = page.node.Contents();
  const contL = doc.context.lookup(cont);
  if (contL && contL.asArray) {
    for (const ref of contL.asArray()) { const s = doc.context.lookup(ref); raws.push(s); }
  } else if (contL) {
    raws.push(contL);
  }
  const bufs = raws.map(s => {
    let b = Buffer.from(s.getContents());
    try { const f = s.get(PDFLib.PDFName.of('Filter')); if (f && String(f).includes('Flate')) b = zlib.inflateSync(b); } catch(e) {}
    return b;
  });
  const buf = Buffer.concat(bufs);
  const text = buf.toString('latin1');
  console.log('streams:', raws.length, 'stream len:', text.length);

  // 找所有 BT..ET 块，列出其中的 Tf/rg/Tm/Td 概要
  const blocks = text.split(/BT/).slice(1).map(b => b.split(/ET/)[0]);
  console.log('BT blocks:', blocks.length);
  blocks.slice(0, 8).forEach((b, i) => {
    const tfs = [...b.matchAll(/\/(\S+) ([\d.]+) Tf/g)].map(m => m[1] + '@' + m[2]);
    const rg = [...b.matchAll(/([\d.]+ [\d.]+ [\d.]+) (rg|RG)/g)].map(m => m[1] + '(' + m[2] + ')');
    const tm = [...b.matchAll(/([-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+ [-\d.]+) Tm/g)].map(m => m[1]);
    const show = (b.match(/Tj|TJ/g) || []).length;
    console.log(`--- block ${i}: Tf=${tfs.slice(0,4).join(',')} rg=${rg.slice(0,2).join('|')} Tm=${tm.slice(0,2).join(' / ')} shows=${show} len=${b.length}`);
  });
  process.exit(0);
})().catch(e => { console.error('FATAL', e && e.message); process.exit(1); });
