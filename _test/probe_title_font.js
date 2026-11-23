/* 分析保单第 1 页的字体资源：BaseFont 名 + 每行文字对应的字体，验证 famFromName 判定 */
const fs = require('fs');
const path = require('path');
const V = path.join(__dirname, '..', 'renderer', 'vendor');
globalThis.DOMMatrix = class { constructor(){ } };
globalThis.Path2D = class { };
globalThis.ImageData = class { constructor(w,h){ this.width=w; this.height=h; } };
const pdfjsLib = require(path.join(V, 'pdf.min.js'));
globalThis.pdfjsWorker = require(path.join(V, 'pdf.worker.min.js'));

const PDFLib = require(path.join(V, 'pdf-lib.min.js'));

(async () => {
  const bytes = fs.readFileSync('C:/Users/Administrator/Desktop/苏M34412-2026年工程机械保单.pdf');
  // 1) pdf-lib 侧：字体资源 BaseFont 名
  const doc = await PDFLib.PDFDocument.load(bytes);
  const page = doc.getPages()[0];
  const res = page.node.Resources();
  const PN = PDFLib.PDFName, PD = PDFLib.PDFDict;
  const fonts = res.lookup(PN.of('Font'), PD);
  const names = [];
  for (const [key, v] of fonts.entries()) {
    const d = doc.context.lookup(v);
    let nm = '', sub = null;
    try { const bf = d.get(PN.of('BaseFont')); if (bf) nm = bf.asString ? bf.asString() : String(bf); } catch(e){}
    try { sub = d.get(PN.of('Subtype')); sub = sub ? (sub.asString ? sub.asString() : String(sub)) : null; } catch(e){}
    try { const fd = d.get(PN.of('FontDescriptor')); if(fd){ const fdD = doc.context.lookup(fd); const fn = fdD.get(PN.of('FontName')); if(fn && !nm) nm = fn.asString?fn.asString():String(fn); const fl = fdD.get(PN.of('Flags')); const dw = fdD.get(PN.of('StemV')); names.push({key, nm, sub, stemV: dw ? String(dw) : null}); continue; } } catch(e){}
    names.push({key, nm, sub});
  }
  console.log('=== 第 1 页字体资源 ===');
  for (const n of names) console.log(JSON.stringify(n));

  // 2) pdf.js 侧：每行文字用的 fontName（映射到上面的资源 key）
  const jc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), cMapUrl: path.join(V,'cmaps','/') + path.sep, cMapPacked: true, standardFontDataUrl: path.join(V,'standard_fonts','/') + path.sep }).promise;
  const jp = await jc.getPage(1);
  const tc = await jp.getTextContent();
  const used = new Map();
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const arr = used.get(it.fontName) || [];
    arr.push(it.str.slice(0, 12));
    used.set(it.fontName, arr);
  }
  console.log('=== 各 fontName 的使用样例 ===');
  for (const [k, v] of used) console.log(k, '->', JSON.stringify(v.slice(0, 3)), `(${v.length} items)`);

  // 2.5) styles 映射：fontName -> fontFamily（看 pdf.js 报的族名）
  console.log('=== styles ===');
  for (const k in (tc.styles||{})) console.log(k, JSON.stringify(tc.styles[k]));

  // 2.6) 标题行 item 的字体/宽度/字号细节
  console.log('=== 标题相关 items ===');
  for (const it of tc.items) {
    if (it.str && (it.str.includes('中国人民财产保险股份') || it.str.includes('起重机械'))) {
      console.log(JSON.stringify({str: it.str.slice(0,20), fontName: it.fontName, w: Math.round(it.width*10)/10, h: Math.round((it.height||0)*10)/10, tf: it.transform}));
    }
  }

  // 3) famFromName 判定结果
  function famFromName(n){
    const s = String(n||'').toLowerCase();
    if(!s) return null;
    if(/fangsong|fang_?song|仿宋|stfangsong/.test(s)) return 'fang';
    if(/kaiti|kai_?ti|楷|stkaiti/.test(s)) return 'kai';
    if(/simsun|nsimsun|songti|stsong|sungti|mingti|mincho|宋|simli/.test(s)) return 'song';
    if(/yahei|simhei|heiti|pingfang|gothic|arialunicode|droidsans|黑/.test(s)) return 'hei';
    return null;
  }
  console.log('=== famFromName 判定 ===');
  for (const n of names) console.log(n.nm, '->', famFromName(n.nm));

  // 4) 标题两行的颜色（内容流里找 BT..ET 的 rg 值）+ 字号/字距
  const content = page.node.Contents ? doc.context.lookup(page.node.Contents) : null;
  // 简化：直接取原始流
  const raw = await page.node.normalizedEntries ? null : null;
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
