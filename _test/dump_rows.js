/* 对比 orig/out 的第 1 页行几何，用于人工诊断 */
const path = require('path');
const fs = require('fs');
function loadPdfjs() {
  globalThis.DOMMatrix = class DOMMatrix { constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; } };
  globalThis.Path2D = class Path2D { moveTo() {} lineTo() {} bezierCurveTo() {} arc() {} rect() {} closePath() {} };
  globalThis.ImageData = class ImageData { constructor(a, b, c) { this.data = a; this.width = b; this.height = c; } };
  const pdfjs = require(path.join(__dirname, '..', 'renderer', 'vendor', 'pdf.min.js'));
  globalThis.pdfjsWorker = require(path.join(__dirname, '..', 'renderer', 'vendor', 'pdf.worker.min.js'));
  return pdfjs;
}
async function rows(file, pdfjs, yMin, yMax) {
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, cMapUrl: path.join(__dirname, '..', 'renderer', 'vendor', 'cmaps') + path.sep, cMapPacked: true, standardFontDataUrl: path.join(__dirname, '..', 'renderer', 'vendor', 'standard_fonts') + path.sep }).promise;
  const pg = await doc.getPage(1);
  const tc = await pg.getTextContent();
  const rows = [];
  for (const it of tc.items) {
    if (!it.str) continue;
    const x = it.transform[4], y = it.transform[5];
    if (yMin != null && (y > yMax || y < yMin)) continue;
    let row = rows.find(r => Math.abs(r.y - y) < 1.2);
    if (!row) { row = { y: Math.round(y * 10) / 10, items: [] }; rows.push(row); }
    row.items.push({ str: it.str, x: Math.round(x * 10) / 10, x1: Math.round((x + it.width) * 10) / 10, font: it.fontName });
  }
  rows.forEach(r => { r.text = r.items.map(i => i.str).join(''); });
  return rows.sort((a, b) => b.y - a.y).map(r => `y=${r.y} x=${r.x0()}->${r.x1()} [${r.items[0].font}] ${r.text.slice(0, 46)}`).join('\n').replace(/x=\d+\.\d+->\d+\.\d+/g, m => m);
}
// 简化 x0/x1
async function rows2(file, pdfjs, yMin, yMax) {
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, cMapUrl: path.join(__dirname, '..', 'renderer', 'vendor', 'cmaps') + path.sep, cMapPacked: true, standardFontDataUrl: path.join(__dirname, '..', 'renderer', 'vendor', 'standard_fonts') + path.sep }).promise;
  const pg = await doc.getPage(1);
  const tc = await pg.getTextContent();
  const rows = [];
  for (const it of tc.items) {
    if (!it.str) continue;
    const x = it.transform[4], y = it.transform[5];
    if (yMin != null && (y > yMax || y < yMin)) continue;
    let row = rows.find(r => Math.abs(r.y - y) < 1.2);
    if (!row) { row = { y: Math.round(y * 10) / 10, its: [] }; rows.push(row); }
    row.its.push(it);
  }
  return rows.sort((a, b) => b.y - a.y).map(r => {
    const x0 = Math.min(...r.its.map(i => i.transform[4]));
    const x1 = Math.max(...r.its.map(i => i.transform[4] + i.width));
    return `y=${r.y} x=${x0.toFixed(1)}->${x1.toFixed(1)} [${r.its[0].fontName}] ${r.its.map(i => i.str).join('').slice(0, 46)}`;
  }).join('\n');
}
(async () => {
  const pdfjs = loadPdfjs();
  const D = path.join(__dirname, '_audit');
  const jobs = [
    ['B', path.join(D, 'B_right.pdf'), path.join(D, 'out_B_right.pdf'), [780, 600]],
    ['C', path.join(D, 'C_table.pdf'), path.join(D, 'out_C_table.pdf'), [745, 580]],
    ['D', path.join(D, 'D_mixfont.pdf'), path.join(D, 'out_D_mixfont.pdf'), null],
    ['E', path.join(D, 'E_bold.pdf'), path.join(D, 'out_E_bold.pdf'), null],
    ['P', 'C:/Users/Administrator/Desktop/苏M34412-2026年工程机械保单.pdf', path.join(D, 'out_policy.pdf'), [760, 660]],
  ];
  for (const [tag, o, n, band] of pairs(jobs)) {
    console.log(`\n######## ${tag} ORIG ########`);
    console.log(await rows2(o, pdfjs, band ? band[1] : null, band ? band[0] : null));
    console.log(`######## ${tag} OUT ########`);
    console.log(await rows2(n, pdfjs, band ? band[1] : null, band ? band[0] : null));
  }
  function pairs(j) { return j; }
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
