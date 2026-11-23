/* 独立渲染导出的 PDF 第 1 页 → 裁剪标题区（y 770~760 高度带，即标题两行） */
const path = require('path');
const fs = require('fs');
globalThis.DOMMatrix = class DOMMatrix { constructor(){ this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0; } };
globalThis.Path2D = class Path2D { moveTo(){} lineTo(){} bezierCurveTo(){} arc(){} rect(){} closePath(){} };
globalThis.ImageData = class ImageData { constructor(a,b,c){ this.data=a; this.width=b; this.height=c; } };
const pdfjsLib = require(path.join(__dirname, '..', 'renderer', 'vendor', 'pdf.min.js'));
globalThis.pdfjsWorker = require(path.join(__dirname, '..', 'renderer', 'vendor', 'pdf.worker.min.js'));
const { createCanvas } = (() => { try { return require('canvas'); } catch(e) { return {}; } })();

(async () => {
  const data = new Uint8Array(fs.readFileSync(path.join(__dirname, '_out', '保单_标题字体验证.pdf')));
  const doc = await pdfjsLib.getDocument({ data, cMapUrl: path.join(__dirname, '..', 'renderer', 'vendor', 'cmaps') + path.sep, cMapPacked: true, standardFontDataUrl: path.join(__dirname, '..', 'renderer', 'vendor', 'standard_fonts') + path.sep }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 2 });
  // 用 OffscreenCanvas（node 22 无 canvas 包；Electron 环境外可用 polyfill）— node 下没有 2D 实现，退化到只验证文字
  const tc = await page.getTextContent();
  const title = tc.items.filter(i => i.str && (i.str.includes('中国人民财产保险股份') || i.str.includes('（验证）') || i.str.includes('保险单号'))).map(i => ({ str: i.str.slice(0, 40), y: Math.round(i.transform[5] * 10) / 10, font: i.fontName }));
  console.log('TITLE ITEMS:', JSON.stringify(title, null, 1));
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
