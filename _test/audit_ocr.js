/* OCR 扫描件表格端到端审计（2026-11-24 截图 bug 回归）：
   扫描保单表格行原来是一条 OCR 行不拆列 → 点一格吞全行 + 字号按整行框高翻倍。
   语料：F_scan_table.pdf（C_table 渲染成的无文字层图片 PDF）。
   运行：先启动 dev（9234），CDP_PORT=9234 node _audit_ocr.js */
const path = require('path');
const fs = require('fs');

const OUTDIR = path.join(__dirname, '_audit');
const PORT = process.env.CDP_PORT || '9234';

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params, timeout = 60000) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, m => m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async (expr, timeout) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, timeout || 60000);
    if (r.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };
  return { ws, send, ev };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function loadPdfjs() {
  globalThis.DOMMatrix = class DOMMatrix { constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; } };
  globalThis.Path2D = class Path2D { moveTo() {} lineTo() {} bezierCurveTo() {} arc() {} rect() {} closePath() {} };
  globalThis.ImageData = class ImageData { constructor(a, b, c) { this.data = a; this.width = b; this.height = c; } };
  const pdfjs = require(path.join(__dirname, '..', 'renderer', 'vendor', 'pdf.min.js'));
  globalThis.pdfjsWorker = require(path.join(__dirname, '..', 'renderer', 'vendor', 'pdf.worker.min.js'));
  return pdfjs;
}
/* 输出 PDF 文字 item 提取（带 size / y / x） */
async function extractItems(file, pdfjs) {
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, cMapUrl: path.join(__dirname, '..', 'renderer', 'vendor', 'cmaps') + path.sep, cMapPacked: true, standardFontDataUrl: path.join(__dirname, '..', 'renderer', 'vendor', 'standard_fonts') + path.sep }).promise;
  const pg = await doc.getPage(1);
  const tc = await pg.getTextContent();
  return tc.items.filter(i => i.str && i.str.trim()).map(i => ({
    str: i.str, x: i.transform[4], y: i.transform[5],
    w: i.width, h: Math.hypot(i.transform[2], i.transform[3]) || i.height || 0
  }));
}

/* 表格几何（gen_audit_corpus.js C_table）：yTop=730 rowH=26
   表头行基线 y=712，字号 11；格左缘 60/200/320/470 (+8 内边距) */
const BAND = { yTop: 722, yBot: 704 };           // 表头行 y 带（基线 ±8）
const TARGET_CELL = { x0: 320, x1: 470 };        // 「发动机号」格

(async () => {
  const pdfjs = loadPdfjs();
  const { ev, send } = await connect();
  await send('Page.enable'); await send('DOM.enable'); await send('Runtime.enable');
  await ev(`window.__E2E__=1`);
  const line = s => process.stdout.write(s + '\n');
  const results = [];
  const R = (name, ok, extra) => { line((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  [' + extra + ']' : '')); results.push([name, ok]); };

  line('==== F_scan_table（OCR 扫描表格） ====');
  const b64 = fs.readFileSync(path.join(OUTDIR, 'F_scan_table.pdf')).toString('base64');
  await ev(`__PS.testOpenDoc('F_scan_table.pdf', '${b64}')`, 120000);
  for (let i = 0; i < 60; i++) { await sleep(1000); if (await ev(`document.querySelectorAll('.pcell').length`).catch(() => 0) >= 1) break; }

  // 打开编辑器 → 等自动 OCR 完成
  await ev(`(async()=>{ __PS.selectTool('edittext'); __PS.testResetEdits(); await __PS.openEditor(0); return ED.open; })()`, 60000);
  let ocrInfo = null;
  for (let i = 0; i < 120; i++) {
    await sleep(1000);
    ocrInfo = await ev(`({ done: !!ED.ocrDone[0], lines: ED.lines.length,
        sample: ED.lines.slice(0, 3).map(L => ({ t: (L.text || '').slice(0, 12), ocr: !!L.ocr, size: +L.size.toFixed(1) })) })`).catch(() => null);
    if (ocrInfo && ocrInfo.done) break;
  }
  line('OCR: ' + JSON.stringify(ocrInfo));
  if (!ocrInfo || !ocrInfo.done) { R('OCR 完成', false); }
  else R('OCR 完成', true);

  // 表头行带内行数（拆列断言）
  const band = await ev(`ED.lines.filter(L => L.y >= ${BAND.yBot} && L.y <= ${BAND.yTop}).map(L => ({ t: L.text, x: +L.x.toFixed(1), x2: +L.x2.toFixed(1), y: +L.y.toFixed(1), h: +L.h.toFixed(1), size: +L.size.toFixed(1) }))`);
  line('表头行带 lines(' + band.length + '): ' + JSON.stringify(band));
  R('F1 表头行已拆列（带内≥2 行，修复前=1）', band.length >= 2, band.map(b => b.t).join(' | '));

  // 选目标格（发动机号）：优先按文本，退化按 x
  const pick = await ev(`(function(){
    let idx = ED.lines.findIndex(L => L.y >= ${BAND.yBot} && L.y <= ${BAND.yTop} && (L.text||'').indexOf('发动机') >= 0);
    if (idx < 0) idx = ED.lines.findIndex(L => L.y >= ${BAND.yBot} && L.y <= ${BAND.yTop} && L.x >= ${TARGET_CELL.x0} && L.x <= ${TARGET_CELL.x1});
    if (idx < 0) return null;
    const pi = ED.paraOf[idx];
    const P = edParaInfo(pi);
    return { idx, pi, text: ED.lines[idx].text, size: P ? P.size : null, x: ED.lines[idx].x, y: ED.lines[idx].y };
  })()`);
  line('目标格: ' + JSON.stringify(pick));
  if (!pick) { R('定位目标格', false); }
  else {
    R('定位目标格', true, pick.text);
    const okApply = await ev(`edApplyParaText(${pick.pi}, '发动机编号')`);
    R('F2 编辑已提交', okApply === true);
    if (okApply) {
      // 画布截图（整窗，供肉眼比对：只改一格、字号不放大）
      try {
        const sc = await send('Page.captureScreenshot', { format: 'png' }, 30000);
        fs.writeFileSync(path.join(OUTDIR, 'ocr_full.png'), Buffer.from(sc.data, 'base64'));
        line('截图已存 ocr_full.png');
      } catch (e) { line('截图失败(不阻断): ' + e.message); }

      // 保存
      line('保存中…');
      await ev(`__PS_SAVED__.length=0`, 30000);
      const sv = await ev(`(async()=>{ const b = await edSaveEdits(); if(!b || !b.length) return null;
        window.__AUD = b; const CH=0x8000, chunks=[];
        for(let o=0;o<b.length;o+=CH) chunks.push(btoa(String.fromCharCode.apply(null, b.subarray(o,o+CH))));
        window.__AUD_CH = chunks; return {len:b.length, n:chunks.length}; })()`, 300000);
      line('保存返回: ' + JSON.stringify(sv));
      if (!sv) { R('保存', false); }
      else {
        let buf = Buffer.alloc(0);
        for (let i = 0; i < sv.n; i++) buf = Buffer.concat([buf, Buffer.from(await ev(`window.__AUD_CH[${i}]`), 'base64')]);
        const outFile = path.join(OUTDIR, 'out_F_scan_table.pdf');
        fs.writeFileSync(outFile, buf);
        line('SAVED: ' + buf.length + ' bytes');
        const items = await extractItems(outFile, pdfjs);
        line('输出文字 items(' + items.length + '): ' + JSON.stringify(items.map(i => ({ s: i.str.slice(0, 14), x: +i.x.toFixed(1), y: +i.y.toFixed(1), h: +i.h.toFixed(1) }))));
        const hit = items.filter(i => i.str.replace(/\s/g, '').includes('发动机编号'));
        R('F3 输出含新文字', hit.length > 0);
        if (hit.length) {
          const t = hit[0];
          R('F4 字号不放大（8~14.5pt，原 11pt）', t.h >= 8 && t.h <= 14.5, 'h=' + t.h.toFixed(1));
          R('F5 位置在本格内（x 320~470）', t.x >= 315 && t.x <= 470, 'x=' + t.x.toFixed(1));
        }
        const bandOut = items.filter(i => i.y >= BAND.yBot && i.y <= BAND.yTop + 4);
        R('F6 表头行带只新增 1 段文字（没吞别的格）', bandOut.length === 1, 'n=' + bandOut.length);
      }
    }
  }

  console.log('\n==== SUMMARY ====');
  let fail = 0;
  for (const [n, ok] of results) { if (!ok) fail++; }
  console.log(results.map(([n, ok]) => (ok ? 'PASS ' : 'FAIL ') + n).join('\n'));
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e); process.exit(2); });
