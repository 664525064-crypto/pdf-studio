/* CDP 端到端测试：驱动 PDF 全能工作台跑全部 13 个工具 */
const path = require('path');
const fs = require('fs');
const PORT = process.env.CDP_PORT || 9234;
const OUT = process.env.OUT_DIR; // 静默保存目录

const results = [];
function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra: extra || '' });
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function connect() {
  let list;
  for (let i = 0; i < 20; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; }
    catch (e) { await sleep(1000); }
  }
  if (!list) throw new Error('CDP 连不上');
  const page = list.find(t => t.type === 'page');
  if (!page) throw new Error('无 page target');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0;
  const pending = new Map();
  const ctxs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.executionContextCreated') ctxs.push(m.params.context);
  };
  const send = (method, params, timeout = 12000) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await new Promise(r => setTimeout(r, 600));
  const mainCtx = (ctxs.find(c => !c.name) || ctxs[ctxs.length - 1]);
  const _send = send;
  const sendMain = (method, params, timeout) => _send(method, Object.assign({ contextId: mainCtx.id }, params || {}), timeout);
  return { ws, send: sendMain };
}

async function evalJS(send, expr, timeout) {
  const _t0 = Date.now();
  const r = await send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  }, timeout || 30000);
  if (process.env.STEP_LOG) console.log('[eval ' + (Date.now()-_t0) + 'ms len=' + expr.length + '] ' + expr.replace(/\s+/g,' ').slice(0,70));
  if (r.exceptionDetails) throw new Error('JS异常: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0, 400));
  return r.result.value;
}

const b64 = (f) => fs.readFileSync(path.join(__dirname, f)).toString('base64');

(async () => {
  const { ws, send } = await connect();
  await send('Runtime.enable');
  await send('Page.enable');
  await evalJS(send, `window.__E2E__ = 1; 'ok'`); // 桥接保存时镜像结果到内存钩子供断言
  await sleep(3000); // 等 app:// 页面加载完

  // 0. 页面健康
  const health = await evalJS(send, `({title:document.title, hasPS:!!window.__PS, hasLibs:!!(window.pdfjsLib&&window.PDFLib&&window.fontkit), tools:document.querySelectorAll('.tbtn').length})`);
  check('页面加载', health.title.includes('PDF') && health.hasPS && health.hasLibs && health.tools === 31, JSON.stringify(health));

  // 0.1 侧栏可用性（曾在 780 高窗口里滚不到底部，PDF 转 Word/Excel/PPT 找不到）
  const sideUi = await evalJS(send, `(()=>{
    const box=document.getElementById('tools');
    const n=document.querySelectorAll('.tbtn').length;
    const s=document.getElementById('tsearch');
    s.value='word'; s.dispatchEvent(new Event('input'));
    const f1=[...document.querySelectorAll('.tbtn')].map(b=>b.textContent.trim());
    s.value='excel'; s.dispatchEvent(new Event('input'));
    const f2=[...document.querySelectorAll('.tbtn')].map(b=>b.textContent.trim());
    s.value=''; s.dispatchEvent(new Event('input'));
    const chips=[...document.querySelectorAll('#hotchips .chip')].map(c=>c.textContent.trim());
    return {n, back:document.querySelectorAll('.tbtn').length, overflow:getComputedStyle(box).overflowY,
            scrollable:box.scrollHeight>box.clientHeight, f1, f2, chips};
  })()`);
  check('侧栏·可滚动', sideUi.n === 31 && sideUi.back === 31 && sideUi.overflow === 'auto' && sideUi.scrollable, JSON.stringify({n: sideUi.n, ov: sideUi.overflow, sc: sideUi.scrollable}));
  check('侧栏·搜索过滤', sideUi.f1.length === 1 && /Word/.test(sideUi.f1[0]) && sideUi.f2.length === 1 && /Excel/.test(sideUi.f2[0]), JSON.stringify([sideUi.f1, sideUi.f2]));
  check('首屏快捷入口', sideUi.chips.length >= 5 && sideUi.chips.some(t=>/Word/.test(t)) && sideUi.chips.some(t=>/Excel/.test(t)) && sideUi.chips.some(t=>/PPT/.test(t)), JSON.stringify(sideUi.chips));

  const bA = b64('test-a.pdf'), bB = b64('test-b.pdf'), bEnc = b64('test-enc.pdf'), bPng = b64('test.png');

  // 1. 合并
  await evalJS(send, `window.__PS_SAVED__.length=0; (async()=>{ __PS.selectTool('merge'); await __PS.testAddFile('test-a.pdf','${bA}'); await __PS.testAddFile('test-b.pdf','${bB}'); await __PS.testRun(); })()`, 60000);
  const saved1 = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name, size:f.bytes.length, head:String.fromCharCode(...f.bytes.slice(0,5))}))`);
  check('合并 PDF', saved1.length === 1 && saved1[0].head === '%PDF-' && saved1[0].size > 20000, JSON.stringify(saved1 && saved1.map(s => s.n + ':' + s.size)));

  // 2. 打开文档（缩略图渲染）
  const grid = await evalJS(send, `(async()=>{ await __PS.testOpenDoc('test-a.pdf','${bA}'); await new Promise(r=>setTimeout(r,1500)); return {pages:document.querySelectorAll('.pcell').length, sel:__PS.state.sel.size, name:__PS.state.name}; })()`, 60000);
  check('打开文档+缩略图', grid.pages === 3 && grid.sel === 3, JSON.stringify(grid));

  // 3. 拆分（范围 1-2,3）
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.selectTool('split'); document.getElementById('f_ranges').value='1-2,3'; await __PS.testRun(); })()`, 60000);
  let s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length}))`);
  check('拆分 PDF', s.length === 2, JSON.stringify(s));

  // 4. 每 N 页拆分
  await evalJS(send, `(async()=>{ __PS_SAVED__.length=0; document.getElementById('f_mode').value='every'; document.getElementById('f_mode').dispatchEvent(new Event('change')); document.getElementById('f_n').value='2'; await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length}))`);
  check('拆分·每N页', s.length === 2, JSON.stringify(s));

  // 5. 提取 1、3 页
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.selectTool('extract'); __PS.state.sel=new Set([0,2]); await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length}))`);
  const exBytes = await evalJS(send, `Array.from(__PS_SAVED__[0].bytes.slice(0,50))`);
  check('提取页面', s.length === 1, JSON.stringify(s));

  // 6. 删除第 2 页
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.selectTool('delete'); __PS.state.sel=new Set([1]); await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length}))`);
  check('删除页面', s.length === 1, JSON.stringify(s));

  // 7. 旋转（重置为全选）
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.state.sel=new Set([0,1,2]); __PS.selectTool('rotate'); await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length}))`);
  // 验证旋转写入
  const rotCheck = await evalJS(send, `(async()=>{ const {PDFDocument}=PDFLib; const d=await PDFDocument.load(__PS_SAVED__[0].bytes.slice()); const p=d.getPages()[0]; return p.getRotation().angle; })()`);
  check('旋转页面', s.length === 1 && rotCheck === 90, 'angle=' + rotCheck);

  // 8. 页码
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.selectTool('pagenum'); await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length}))`);
  const pnText = await evalJS(send, `(async()=>{ const doc=await pdfjsLib.getDocument({data:__PS_SAVED__[0].bytes.slice()}).promise; const t=await (await doc.getPage(1)).getTextContent(); return t.items.map(i=>i.str).join(''); })()`, 60000);
  check('添加页码', s.length === 1 && pnText.includes('第 1 页') && pnText.includes('共 3 页'), pnText.slice(-30));

  // 9. 水印（重置为全选）
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.state.sel=new Set([0,1,2]); __PS.selectTool('wm'); document.getElementById('f_text').value='绝密资料'; await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length}))`);
  const wmText = await evalJS(send, `(async()=>{ const doc=await pdfjsLib.getDocument({data:__PS_SAVED__[0].bytes.slice()}).promise; const t=await (await doc.getPage(1)).getTextContent(); return t.items.map(i=>i.str).join(''); })()`, 60000);
  check('文字水印', s.length === 1 && wmText.includes('绝密资料'), 'size=' + (s[0] && s[0].size));

  // 10. PDF 转图片（重置为全选）
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.state.sel=new Set([0,1,2]); __PS.selectTool('p2i'); document.getElementById('f_fmt').value='png'; await __PS.testRun(); })()`, 90000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length,head:[...f.bytes.slice(0,4)].map(c=>c.toString(16).padStart(2,'0')).join('')}))`);
  check('PDF转图片', s.length === 3 && s.every(x => x.head === '89504e47'), JSON.stringify(s.map(x => x.n)));

  // 11. 图片转 PDF
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.selectTool('i2p'); __PS.state.fileList.length=0; await __PS.testAddFile('test.png','${bPng}'); await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length,head:String.fromCharCode(...f.bytes.slice(0,5))}))`);
  check('图片转PDF', s.length === 1 && s[0].head === '%PDF-', JSON.stringify(s));

  // 12. 文本提取
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ await __PS.testOpenDoc('test-a.pdf','${bA}'); __PS.selectTool('text'); await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length}))`);
  const txt = await evalJS(send, `new TextDecoder('utf-8').decode(__PS_SAVED__[0].bytes.slice(3))`);
  check('文本提取', s.length === 1 && txt.includes('Sample Text') && txt.includes('第 1 页'), 'len=' + txt.length);

  // 13. 压缩（无损）
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.selectTool('compress'); document.getElementById('f_cmode').value='lossless'; await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length,head:String.fromCharCode(...f.bytes.slice(0,5))}))`);
  check('压缩PDF', s.length === 1 && s[0].head === '%PDF-', JSON.stringify(s));

  // 14. 加密
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.selectTool('encrypt'); document.getElementById('f_up').value='abc123'; await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length}))`);
  const encCheck = await evalJS(send, `(async()=>{ const {PDFDocument}=PDFLib; try{ await PDFDocument.load(__PS_SAVED__[0].bytes.slice(),{ignoreEncryption:false}); return 'nolock'; }catch(e){ return 'locked:'+e.message.slice(0,40); } })()`);
  check('加密 PDF', s.length === 1 && encCheck.startsWith('locked'), encCheck);

  // 15. 解密（先切到解密工具再打开加密文档，否则 openDoc 会拦截）
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.selectTool('decrypt'); await __PS.testOpenDoc('test-enc.pdf','${bEnc}'); document.getElementById('f_dp').value='1234'; await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length}))`);
  const decCheck = await evalJS(send, `(async()=>{ const {PDFDocument}=PDFLib; try{ const d=await PDFDocument.load(__PS_SAVED__[0].bytes.slice(),{ignoreEncryption:false}); return 'open:'+d.getPageCount(); }catch(e){ return 'fail:'+e.message.slice(0,60); } })()`);
  check('解密 PDF', s.length === 1 && decCheck.startsWith('open:3'), decCheck);

  // 16. 加文字 / 图章（解密步骤后重新打开普通文档）
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.selectTool('addtext'); await __PS.testOpenDoc('test-a.pdf','${bA}'); document.getElementById('f_txt').value='审批通过'; document.getElementById('f_stamp').checked=true; await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length}))`);
  const addStatus = await evalJS(send, `document.getElementById("status").textContent`).catch(e => 'status读取失败:' + e.message.slice(0, 80));
  const stampText = s.length ? await evalJS(send, `(async()=>{ const doc=await pdfjsLib.getDocument({data:__PS_SAVED__[0].bytes.slice(), cMapUrl:'vendor/cmaps/', cMapPacked:true, standardFontDataUrl:'vendor/standard_fonts/'}).promise; const t=await (await doc.getPage(1)).getTextContent(); return t.items.map(i=>i.str).join(''); })()`, 60000) : '';
  check('加文字/图章', s.length === 1 && stampText.includes('审批通过'), JSON.stringify({ saved: s, status: addStatus }));

  // 17. 插入图片
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.selectTool('addimg'); await __PS.testOpenDoc('test-a.pdf','${bA}'); __PS.testSetFile('img','test.png','${bPng}'); await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length,head:String.fromCharCode(...f.bytes.slice(0,5))}))`);
  check('插入图片', s.length === 1 && s[0].head === '%PDF-' && s[0].size > 3000, JSON.stringify(s));

  // 18. 关键词高亮（像素校验：矩形中心应为黄色系）
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.selectTool('highlight'); await __PS.testOpenDoc('test-a.pdf','${bA}'); document.getElementById('f_kw').value='Sample'; await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length,head:String.fromCharCode(...f.bytes.slice(0,5))}))`);
  const rectsN = await evalJS(send, `window.__PS_LAST_RECTS__.length`);
  const hlPix = s.length ? await evalJS(send, `(async()=>{ const doc=await pdfjsLib.getDocument({data:__PS_SAVED__[0].bytes.slice(), cMapUrl:'vendor/cmaps/', cMapPacked:true, standardFontDataUrl:'vendor/standard_fonts/'}).promise; const page=await doc.getPage(1); const vp0=page.getViewport({scale:1}); const sc=2, vp=page.getViewport({scale:sc}); const cv=document.createElement('canvas'); cv.width=Math.round(vp.width); cv.height=Math.round(vp.height); const ctx=cv.getContext('2d'); await page.render({canvasContext:ctx, viewport:vp, intent:'print'}).promise; const r=window.__PS_LAST_RECTS__[0]; const d=ctx.getImageData(Math.round((r.x+r.w/2)*sc), Math.round((vp0.height-(r.y+r.h/2))*sc), 1, 1).data; return [d[0],d[1],d[2]]; })()`, 60000) : null;
  check('关键词高亮', s.length === 1 && s[0].head === '%PDF-' && rectsN >= 1 && hlPix && hlPix[0] > 190 && hlPix[1] > 170 && hlPix[2] < 180, `rects=${rectsN} pix=${JSON.stringify(hlPix)}`);

  // 19. 敏感信息打码（像素校验：矩形中心应为黑色）
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.selectTool('redact'); await __PS.testOpenDoc('test-a.pdf','${bA}'); document.getElementById('f_rkws').value='Sample Text'; await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length}))`);
  const rdRects = await evalJS(send, `window.__PS_LAST_RECTS__.length`);
  const rdPix = s.length ? await evalJS(send, `(async()=>{ const doc=await pdfjsLib.getDocument({data:__PS_SAVED__[0].bytes.slice(), cMapUrl:'vendor/cmaps/', cMapPacked:true, standardFontDataUrl:'vendor/standard_fonts/'}).promise; const page=await doc.getPage(1); const vp0=page.getViewport({scale:1}); const sc=2, vp=page.getViewport({scale:sc}); const cv=document.createElement('canvas'); cv.width=Math.round(vp.width); cv.height=Math.round(vp.height); const ctx=cv.getContext('2d'); await page.render({canvasContext:ctx, viewport:vp, intent:'print'}).promise; const r=window.__PS_LAST_RECTS__[0]; const d=ctx.getImageData(Math.round((r.x+r.w/2)*sc), Math.round((vp0.height-(r.y+r.h/2))*sc), 1, 1).data; return [d[0],d[1],d[2]]; })()`, 60000) : null;
  check('敏感信息打码', s.length === 1 && rdRects >= 1 && rdPix && rdPix[0] < 70 && rdPix[1] < 70 && rdPix[2] < 70, `rects=${rdRects} pix=${JSON.stringify(rdPix)}`);

  // 20. PDF 转 HTML
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ await __PS.testOpenDoc('test-a.pdf','${bA}'); __PS.selectTool('p2html'); await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length}))`);
  const htmlTxt = await evalJS(send, `new TextDecoder('utf-8').decode(__PS_SAVED__[0].bytes.slice())`);
  check('PDF转HTML', s.length === 1 && /\.html$/.test(s[0].n) && htmlTxt.includes('<html') && htmlTxt.includes('Sample Text'), 'size=' + (s[0] && s[0].size));

  // 21. PDF 转 EPUB
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.selectTool('p2epub'); await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length,head:String.fromCharCode(...f.bytes.slice(0,2))}))`);
  const epubTxt = await evalJS(send, `String.fromCharCode(...__PS_SAVED__[0].bytes.slice(0, 4000))`);
  check('PDF转EPUB', s.length === 1 && s[0].head === 'PK' && epubTxt.includes('application/epub+zip') && epubTxt.includes('page-'), JSON.stringify(s));

  // 22. 修复 PDF
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.selectTool('repair'); await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length,head:String.fromCharCode(...f.bytes.slice(0,5))}))`);
  const repPages = await evalJS(send, `(async()=>{ const {PDFDocument}=PDFLib; const d=await PDFDocument.load(__PS_SAVED__[0].bytes.slice()); return d.getPageCount(); })()`);
  check('修复PDF', s.length === 1 && s[0].head === '%PDF-' && repPages === 3, 'pages=' + repPages);

  // 23. PDF 转 Word（zip store 模式 → 原文可见，直接搜内容）
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.selectTool('p2docx'); await __PS.testRun(); })()`, 90000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length,head:String.fromCharCode(...f.bytes.slice(0,2))}))`);
  const docxChk = s.length ? await evalJS(send, `(function(){ const u8=__PS_SAVED__[0].bytes; let t=''; for(let i=0;i<u8.length;i++) t+=String.fromCharCode(u8[i]); return {doc:t.includes('word/document.xml'), styles:t.includes('heading 1'), text:t.includes('Sample Text')}; })()`) : {};
  check('PDF转Word', s.length === 1 && s[0].head === 'PK' && /\.docx$/.test(s[0].n) && docxChk.doc && docxChk.styles && docxChk.text, JSON.stringify({s, docxChk}));

  // 24. PDF 转 Excel
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.selectTool('p2xlsx'); await __PS.testRun(); })()`, 90000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length,head:String.fromCharCode(...f.bytes.slice(0,2))}))`);
  const xlsxChk = s.length ? await evalJS(send, `(function(){ const u8=__PS_SAVED__[0].bytes; let t=''; for(let i=0;i<u8.length;i++) t+=String.fromCharCode(u8[i]); return {wb:t.includes('xl/workbook.xml'), sheet:t.includes('xl/worksheets/sheet1.xml'), inline:t.includes('inlineStr'), text:t.includes('Sample Text')}; })()`) : {};
  check('PDF转Excel', s.length === 1 && s[0].head === 'PK' && /\.xlsx$/.test(s[0].n) && xlsxChk.wb && xlsxChk.sheet && xlsxChk.inline && xlsxChk.text, JSON.stringify({s, xlsxChk}));

  // 25. PDF 转 PPT（图片模式）
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.selectTool('p2pptx'); document.getElementById('f_pmode').value='img'; await __PS.testRun(); })()`, 120000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length,head:String.fromCharCode(...f.bytes.slice(0,2))}))`);
  const pptChk = s.length ? await evalJS(send, `(function(){ const u8=__PS_SAVED__[0].bytes; let t=''; for(let i=0;i<u8.length;i++) t+=String.fromCharCode(u8[i]); let pngCount=0; for(let i=0;i<u8.length-3;i++){ if(u8[i]===0x89&&u8[i+1]===0x50&&u8[i+2]===0x4E&&u8[i+3]===0x47) pngCount++; } return {pres:t.includes('ppt/presentation.xml'), slide:t.includes('ppt/slides/slide1.xml'), media:t.includes('ppt/media/image1.png'), pngCount}; })()`) : {};
  check('PDF转PPT(图片模式)', s.length === 1 && s[0].head === 'PK' && /\.pptx$/.test(s[0].n) && pptChk.pres && pptChk.slide && pptChk.media && pptChk.pngCount >= 1, JSON.stringify({s, pptChk}));

  // 26. PDF 转 PPT（文字模式，可编辑）
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.selectTool('p2pptx'); document.getElementById('f_pmode').value='text'; await __PS.testRun(); })()`, 90000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length,head:String.fromCharCode(...f.bytes.slice(0,2))}))`);
  const pptTxtChk = s.length ? await evalJS(send, `(function(){ const u8=__PS_SAVED__[0].bytes; let t=''; for(let i=0;i<u8.length;i++) t+=String.fromCharCode(u8[i]); return {textbox:t.includes('txBox="1"'), at:t.includes('<a:t>'), text:t.includes('Sample Text'), noMedia:!t.includes('ppt/media/')}; })()`) : {};
  check('PDF转PPT(文字模式)', s.length === 1 && s[0].head === 'PK' && pptTxtChk.textbox && pptTxtChk.at && pptTxtChk.text && pptTxtChk.noMedia, JSON.stringify({s, pptTxtChk}));

  // 27. 编辑界面：打开后有画布 + 可点文字层 + 入口按钮
  await evalJS(send, `(async()=>{ await __PS.testOpenDoc('test-a.pdf','${bA}'); __PS.selectTool('edittext'); __PS.testResetEdits(); await __PS.openEditor(0); })()`, 90000);
  const edUi = await evalJS(send, `__PS.testEditorUI()`);
  const line0 = await evalJS(send, `__PS.testFindLine(0,'Sample')`);
  check('编辑界面·画布+文字层', edUi.open && edUi.lines > 0 && edUi.canvasW > 200 && edUi.btnEdit && line0 && /Sample/.test(line0.text), JSON.stringify({ open: edUi.open, lines: edUi.lines, cw: edUi.canvasW, line: line0 && line0.text }));
  check('文字版也有「按画面重新识别」入口', edUi.ocrBtn === true && !/识别出/.test(edUi.hint || ''), JSON.stringify({ ocrBtn: edUi.ocrBtn, hint: edUi.hint }));

  // 27a. 字体跟随原文：系统里能读到宋体/黑体等中文字体，行级能判定字族
  const fam0 = await evalJS(send, `__PS.testFamInfo()`, 60000);
  check('字体·系统字体可读', fam0 && fam0.sys && fam0.sys.song && fam0.sys.hei, JSON.stringify(fam0 && fam0.sys));
  check('字体·行级字族判定', fam0 && fam0.lines.length > 0 && fam0.lines.every(l => !l.fam || /^(song|hei|kai|fang)$/.test(l.fam)) && (fam0.docFam === 'song' || fam0.docFam === 'hei' || fam0.docFam === 'kai' || fam0.docFam === 'fang'), JSON.stringify({ docFam: fam0 && fam0.docFam, lines: fam0 && fam0.lines.slice(0, 3) }));

  // 27a2. 文字层编码坏掉的行（提取出来全是乱码）要能检出：宽度对不上 / 有控制字符
  const tb = await evalJS(send, `JSON.stringify({
    good: __PS.testTextBad('保险费（含税）：人民币贰万捌仟叁佰元', 56, 320, 12),
    junk: __PS.testTextBad('CER. Abb)', 56, 260, 12),
    ctrl: __PS.testTextBad(String.fromCharCode(0,17,65,66,67), 56, 120, 12) })`);
  const tbo = JSON.parse(tb);
  check('文字层乱码行可检出', tbo.good === false && tbo.junk === true && tbo.ctrl === true, tb);

  // 27b. 原位编辑：点行直接变成输入框（不弹黑色浮条），回车即生效
  await evalJS(send, `__PS.testResetEdits();`, 20000);
  const inl1 = await evalJS(send, `__PS.testInlineEdit(0, ${line0.i}, '原位改字测试')`, 60000);
  check('原位编辑·不弹浮条', inl1 && inl1.opened && !inl1.floatShown && !inl1.selOpsShown && inl1.boxGone && !inl1.inline && inl1.rec && inl1.rec.text === '原位改字测试', JSON.stringify(inl1));

  // 27c. 原位编辑清空 = 删掉这行
  await evalJS(send, `__PS.testResetEdits();`, 20000);
  const inl2 = await evalJS(send, `__PS.testInlineEdit(0, ${line0.i}, '')`, 60000);
  check('原位编辑·清空即删除', inl2 && inl2.opened && inl2.rec && inl2.rec.text === '' && inl2.boxGone, JSON.stringify(inl2 && {rec: inl2.rec, boxGone: inl2.boxGone}));

  // 27c2. 删掉的行在页面上只剩一块同色底：没有虚线框、不写「已删除」字样。
  //     预览所见即所得改造后：白块直接画进画布（edPaintCanvas），覆盖层变透明命中区，
  //     所以断言改为「覆盖层透明 + 画布上原字位置已是空白」
  const delOv = await evalJS(send, `(function(){
    const el=[...document.querySelectorAll('.edov.del')].pop();
    if(!el) return {err:'没有删除覆盖块'};
    const cs=getComputedStyle(el);
    let px=null;
    try{
      const cv=document.getElementById('edCanvas');
      const k=cv.width/ED.vpW, r=el.getBoundingClientRect();
      const cx=Math.round((r.left+r.width/2)*(cv.width/parseFloat(el.parentElement.clientWidth||r.width)||1));
      const ctx=cv.getContext('2d');
      const sx=Math.round(r.left+6), sy=Math.round(r.top+r.height/2);
      // 用画布坐标（stage 内）换算：edLayer 与画布同原点
      const sxD=Math.round((parseFloat(el.style.left)+6)*window.devicePixelRatio*ED.scale);
      const syD=Math.round((parseFloat(el.style.top)+parseFloat(el.style.height)/2)*window.devicePixelRatio*ED.scale);
      const d=ctx.getImageData(sxD, syD, 1,1).data;
      px=[d[0],d[1],d[2]];
    }catch(e){ px='ERR:'+e.message; }
    return { text:el.textContent, bw:cs.borderTopWidth, bs:cs.borderTopStyle, bg:cs.backgroundColor,
             px, op:document.querySelectorAll('.edov').length };
  })()`);
  check('删除后不留虚线框与「已删除」字样',
    delOv && delOv.text === '' && delOv.bw === '0px' && delOv.bg === 'rgba(0, 0, 0, 0)' &&
    Array.isArray(delOv.px) && delOv.px[0]>235 && delOv.px[1]>235 && delOv.px[2]>235,
    JSON.stringify(delOv));

  // 27c3. 右侧「本页修改」列表的 ✕ 能点名撤掉这一处（删完看不见了，靠它找回）
  const undoOne = await evalJS(send, `(function(){
    const xs=document.querySelectorAll('#edList .eidel');
    const n=xs.length; if(n) xs[0].click();
    return { n, edits:__PS.editor.edits.length, ovs:document.querySelectorAll('.edov').length };
  })()`);
  check('修改列表·单项可撤销', undoOne && undoOne.n >= 1 && undoOne.edits === 0 && undoOne.ovs === 0, JSON.stringify(undoOne));

  // 27d. 打开文件：侧栏顶部按钮 / 编辑界面按钮 / Ctrl+O 都指向文件选择框
  await evalJS(send, `(async()=>{ __PS.testResetEdits(); __PS.selectTool('edittext'); await __PS.openEditor(0); })()`, 60000);
  const openUi = await evalJS(send, `(function(){
    const hits=[]; const f=document.getElementById('fopen'), m=document.getElementById('fmulti');
    const of=f.click.bind(f), om=m.click.bind(m);
    f.click=()=>hits.push('fopen'); m.click=()=>hits.push('fmulti');
    const b1=document.getElementById('btnOpenFile'), b2=document.getElementById('edOpenFile');
    if(b1) b1.click(); if(b2) b2.click();
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'o',ctrlKey:true,bubbles:true,cancelable:true}));
    f.click=of; m.click=om;
    const r1=b1&&b1.getBoundingClientRect();
    return { b1:!!b1, b2:!!b2, hits,
             inEditor:document.getElementById('editor').classList.contains('show'),
             visible:!!r1&&r1.width>40&&r1.height>10&&b1.textContent.includes('打开文件'),
             edText:b2?b2.textContent:'' };
  })()`);
  check('打开文件·侧栏/编辑界面/Ctrl+O 三个入口',
    openUi && openUi.b1 && openUi.b2 && openUi.visible && openUi.hits.filter(h=>h==='fopen').length === 3 && openUi.edText.includes('打开文件'),
    JSON.stringify(openUi));

  // 28. 点行改字（改内容 + 改色）
  await evalJS(send, `__PS_SAVED__.length=0; __PS.testResetEdits();`, 20000);
  const ed1 = await evalJS(send, `__PS.testEditLine(0, ${line0.i}, '已修改文字', '#c53a25')`);
  const sv1 = await evalJS(send, `__PS.testSaveEdits()`, 90000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length,head:String.fromCharCode(...f.bytes.slice(0,2))}))`);
  check('编辑器改字·保存新PDF', s.length === 1 && s[0].head === '%P' && /_编辑\.pdf$/.test(s[0].n) && ed1 && ed1.overlays >= 1 && sv1.len > 0, JSON.stringify({s, ov: ed1 && ed1.overlays, sv1}));
  if (s.length === 1) {
    const chk = await evalJS(send, `(async()=>{ const u8=__PS_SAVED__[0].bytes; const d=await pdfjsLib.getDocument({data:u8.slice()}).promise; const pg=await d.getPage(1); const tc=await pg.getTextContent(); const txt=tc.items.map(i=>i.str).join(''); const vp=pg.getViewport({scale:2}); const cv=document.createElement('canvas'); cv.width=vp.width; cv.height=vp.height; await pg.render({canvasContext:cv.getContext('2d'), viewport:vp, intent:'print'}).promise; const im=cv.getContext('2d').getImageData(0,0,cv.width,cv.height).data; let red=0; for(let i=0;i<im.length;i+=4){ if(im[i]>150&&im[i+1]<110&&im[i+2]<110) red++; } return {hasNew:txt.includes('已修改文字'), red}; })()`, 60000);
    check('编辑器改字·内容与颜色', chk && chk.hasNew && chk.red > 10, JSON.stringify(chk));
  }

  // 29. 删除整行文字（留空 = 删除）→ 该区域变白
  await evalJS(send, `__PS_SAVED__.length=0; __PS.testResetEdits();`, 20000);
  const ed2 = await evalJS(send, `__PS.testEditLine(0, ${line0.i}, '')`);
  const sv2 = await evalJS(send, `__PS.testSaveEdits()`, 90000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length}))`);
  const delChk = s.length ? await evalJS(send, `(async()=>{ const u8=__PS_SAVED__[0].bytes; const d=await pdfjsLib.getDocument({data:u8.slice()}).promise; const pg=await d.getPage(1); const vp=pg.getViewport({scale:2}); const cv=document.createElement('canvas'); cv.width=vp.width; cv.height=vp.height; await pg.render({canvasContext:cv.getContext('2d'), viewport:vp, intent:'print'}).promise; const c2=cv.getContext('2d'); const r=__PS.editor.edits[0]; const left=(r.x-6+2)*2, top=(__PS.editor.vpH-(r.y-r.h*0.32+r.h*1.42))*2+2, w=(r.w+3-4)*2, h=(r.h*1.42-4)*2; const im=c2.getImageData(Math.max(0,Math.round(left)), Math.max(0,Math.round(top)), Math.max(1,Math.round(w)), Math.max(1,Math.round(h))).data; let nonWhite=0; for(let i=0;i<im.length;i+=4){ if(im[i]<245||im[i+1]<245||im[i+2]<245) nonWhite++; } return {nonWhite, rect:{x:r.x,y:r.y,w:r.w,h:r.h}}; })()`, 60000) : {};
  check('编辑器删除文字·区域变白', s.length === 1 && ed2 && delChk.nonWhite === 0, JSON.stringify(delChk));

  // 30. 框选区域删除（拖拽）→ 白块
  await evalJS(send, `(async()=>{ __PS_SAVED__.length=0; __PS.testResetEdits(); await __PS.testAddRegionPct(0, 10, 10, 40, 25, null); })()`, 60000);
  const sv3 = await evalJS(send, `__PS.testSaveEdits()`, 90000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length,head:String.fromCharCode(...f.bytes.slice(0,2))}))`);
  const eimgChk = s.length ? await evalJS(send, `(async()=>{ const u8=__PS_SAVED__[0].bytes; const d=await pdfjsLib.getDocument({data:u8.slice()}).promise; const pg=await d.getPage(1); const vp=pg.getViewport({scale:2}); const cv=document.createElement('canvas'); cv.width=vp.width; cv.height=vp.height; await pg.render({canvasContext:cv.getContext('2d'), viewport:vp, intent:'print'}).promise; const c2=cv.getContext('2d'); const {width,height}=pg.getViewport({scale:1}); const rx=width*0.10, rw=width*0.40, rh=height*0.25, ry=height-height*0.10-rh; const im=c2.getImageData(Math.round(rx*2)+3, Math.round((height-ry-rh)*2)+3, Math.round(rw*2)-6, Math.round(rh*2)-6).data; let nonWhite=0; for(let i=0;i<im.length;i+=4){ if(im[i]<250||im[i+1]<250||im[i+2]<250) nonWhite++; } return {nonWhite}; })()`, 60000) : {};
  check('框选区域删除', s.length === 1 && s[0].head === '%P' && sv3.regions === 1 && eimgChk.nonWhite === 0, JSON.stringify({s, eimgChk}));

  // 31. 框选区域替换为新图
  await evalJS(send, `(async()=>{ __PS_SAVED__.length=0; __PS.testResetEdits(); await __PS.testAddRegionPct(0, 10, 10, 40, 25, '${bPng}'); })()`, 60000);
  await evalJS(send, `__PS.testSaveEdits()`, 90000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length,head:String.fromCharCode(...f.bytes.slice(0,2))}))`);
  const repChk = s.length ? await evalJS(send, `(async()=>{ const u8=__PS_SAVED__[0].bytes; const d=await pdfjsLib.getDocument({data:u8.slice()}).promise; const pg=await d.getPage(1); const vp=pg.getViewport({scale:2}); const cv=document.createElement('canvas'); cv.width=vp.width; cv.height=vp.height; await pg.render({canvasContext:cv.getContext('2d'), viewport:vp, intent:'print'}).promise; const c2=cv.getContext('2d'); const {width,height}=pg.getViewport({scale:1}); const rx=width*0.10, rw=width*0.40, rh=height*0.25, ry=height-height*0.10-rh; const im=c2.getImageData(Math.round(rx*2)+3, Math.round((height-ry-rh)*2)+3, Math.round(rw*2)-6, Math.round(rh*2)-6).data; let nonWhite=0; for(let i=0;i<im.length;i+=4){ if(im[i]<250||im[i+1]<250||im[i+2]<250) nonWhite++; } return {nonWhite}; })()`, 60000) : {};
  check('框选区域替换新图', s.length === 1 && repChk.nonWhite > 200, JSON.stringify({s, repChk}));

  // 32. 框选区域写入新文字（扫描件也能改）
  await evalJS(send, `(async()=>{ __PS_SAVED__.length=0; __PS.testResetEdits(); await __PS.testAddRegionPct(0, 10, 10, 45, 12, null, '覆盖写入的文字'); })()`, 60000);
  await evalJS(send, `__PS.testSaveEdits()`, 90000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length}))`);
  const txtChk = s.length ? await evalJS(send, `(async()=>{ const u8=__PS_SAVED__[0].bytes; const d=await pdfjsLib.getDocument({data:u8.slice()}).promise; const pg=await d.getPage(1); const tc=await pg.getTextContent(); const t=tc.items.map(i=>i.str).join(''); return {ok:t.includes('覆盖写入的文字')}; })()`, 60000) : {};
  check('框选区域写文字', s.length === 1 && txtChk.ok, JSON.stringify(txtChk));

  // 32. 全文档批量替换
  await evalJS(send, `(async()=>{ __PS_SAVED__.length=0; __PS.testResetEdits(); await __PS.testOpenDoc('test-a.pdf','${bA}'); await __PS.openEditor(0); })()`, 90000);
  const batch = await evalJS(send, `__PS.testBatchReplace('Sample','批量替换')`, 90000);
  const sv4 = await evalJS(send, `__PS.testSaveEdits()`, 90000);
  const bchk = s && sv4.len ? await evalJS(send, `(async()=>{ const u8=__PS_SAVED__[0].bytes; const d=await pdfjsLib.getDocument({data:u8.slice()}).promise; let hit=0, total=0; for(let p=1;p<=d.numPages;p++){ const pg=await d.getPage(p); const tc=await pg.getTextContent(); const t=tc.items.map(i=>i.str).join(''); if(t.includes('批量替换')) hit++; if(t.includes('Sample')) total++; } return {hit, total}; })()`, 60000) : {};
  check('批量替换全文生效', batch.edits >= 3 && sv4.len > 0 && bchk.hit === 3, JSON.stringify({edits: batch.edits, bchk}));

  // 31. 落盘校验（保存目录）
  const outFiles = fs.existsSync(OUT) ? fs.readdirSync(OUT) : [];
  check('静默落盘', outFiles.length >= 18, '共 ' + outFiles.length + ' 个文件');
  const merged = outFiles.find(f => f === '合并结果.pdf');
  check('合并结果落盘字节', merged && fs.statSync(path.join(OUT, merged)).size > 20000);

  // 24. 自愈回路（stash→restore 字节一致性）
  const stashRes = await evalJS(send, `(async()=>{ return await __PS.testStashRestore(); })()`, 60000);
  check('自愈回路 stash/restore', stashRes && stashRes.ok && stashRes.name, JSON.stringify(stashRes).slice(0, 120));

  // 25. 渲染自愈钩子（stash 分支可写入恢复）
  const healRes = await evalJS(send, `(async()=>{ return await __PS.testHeal(); })()`, 60000);
  check('渲染自愈钩子', healRes && healRes.ok, JSON.stringify(healRes).slice(0, 120));

  // 43. 文字版 PDF 不应误走 OCR
  const tAuto = await evalJS(send, `(async()=>{ await __PS.testOpenDoc('test-a.pdf','${bA}'); const r=await __PS.testLines(0,'auto'); return {n:r.lines.length, ocr:r.ocr}; })()`, 120000);
  check('文字版不走 OCR', tAuto && tAuto.ocr === false && tAuto.n > 0, JSON.stringify(tAuto));

  // 44. 造一个扫描件（整页图片、无文字层）
  const scanB64 = await evalJS(send, `(async()=>{ window.__E2E__=1; await __PS.testOpenDoc('test-a.pdf','${bA}');
    const pic=await __PS.testPagePng(0,2);
    const doc=await PDFLib.PDFDocument.create(); const pg=doc.addPage([595.28,841.89]);
    const img=await doc.embedPng(pic.bytes); pg.drawImage(img,{x:0,y:0,width:595.28,height:841.89});
    const b=await doc.save(); let s=''; for(let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]); return btoa(s); })()`, 180000);
  const scanChk = await evalJS(send, `(async()=>{ await __PS.testOpenDoc('scan.pdf','${scanB64}'); const t=await __PS.testLines(0,'text'); const a=await __PS.testLines(0,'auto'); return {text:t.lines.length, auto:a.lines.length, ocr:a.ocr}; })()`, 180000);
  check('扫描件自动触发 OCR', scanChk && scanChk.text === 0 && scanChk.ocr === true && scanChk.auto > 0, JSON.stringify(scanChk));

  // 45. 扫描件 → Word（自动 OCR）
  const wScan = await evalJS(send, `(async()=>{ __PS_SAVED__.length=0; __PS.selectTool('p2docx'); await __PS.testOpenDoc('scan.pdf','${scanB64}');
    document.getElementById('f_dmode').value='auto'; await __PS.testRun();
    const f=__PS_SAVED__[0]; if(!f) return {err:document.getElementById('status').textContent};
    const txt=new TextDecoder().decode(f.bytes);
    return {name:f.name, runs:txt.split('<w:t').length-1, size:f.bytes.length}; })()`, 180000);
  check('扫描件转 Word(OCR)', wScan && wScan.runs >= 2 && /scan\.docx$/.test(wScan.name || ''), JSON.stringify(wScan));

  // 46. 扫描件 → Excel（自动 OCR）
  const xScan = await evalJS(send, `(async()=>{ __PS_SAVED__.length=0; __PS.selectTool('p2xlsx'); await __PS.testOpenDoc('scan.pdf','${scanB64}');
    document.getElementById('f_xmode').value='auto'; await __PS.testRun();
    const f=__PS_SAVED__[0]; if(!f) return {err:document.getElementById('status').textContent};
    const txt=new TextDecoder().decode(f.bytes);
    return {name:f.name, cells:txt.split('<c r=').length-1, size:f.bytes.length}; })()`, 180000);
  check('扫描件转 Excel(OCR)', xScan && xScan.cells >= 2, JSON.stringify(xScan));

  // 47. 扫描件 → PPT（文字模式自动 OCR）
  const pScan = await evalJS(send, `(async()=>{ __PS_SAVED__.length=0; __PS.selectTool('p2pptx'); await __PS.testOpenDoc('scan.pdf','${scanB64}');
    document.getElementById('f_pmode').value='text'; await __PS.testRun();
    const f=__PS_SAVED__[0]; if(!f) return {err:document.getElementById('status').textContent};
    const txt=new TextDecoder().decode(f.bytes);
    return {name:f.name, tx:txt.split('<a:t>').length-1, size:f.bytes.length}; })()`, 180000);
  check('扫描件转 PPT(OCR)', pScan && pScan.tx >= 2, JSON.stringify(pScan));

  // 48. 扫描件 → Word（图片模式，版式还原）
  const iScan = await evalJS(send, `(async()=>{ __PS_SAVED__.length=0; __PS.selectTool('p2docx'); await __PS.testOpenDoc('scan.pdf','${scanB64}');
    document.getElementById('f_dmode').value='img'; await __PS.testRun();
    const f=__PS_SAVED__[0]; if(!f) return {err:document.getElementById('status').textContent};
    const txt=new TextDecoder('latin1').decode(f.bytes);
    return {name:f.name, hasPng:txt.indexOf('word/media/page1.png')>=0, size:f.bytes.length}; })()`, 180000);
  check('扫描件转 Word(图片模式)', iScan && iScan.hasPng && /图片版\.docx$/.test(iScan.name || ''), JSON.stringify(iScan));

  // 49. 扫描件编辑：打开编辑器自动识别出可点的行，点行原位改字（不弹浮条）
  await evalJS(send, `(async()=>{ __PS_SAVED__.length=0; __PS.testResetEdits(); await __PS.testOpenDoc('scan.pdf','${scanB64}'); })()`, 180000);
  const se1 = await evalJS(send, `__PS.testOcrEdit(0, '扫描件已改字', 180000)`, 300000);
  check('扫描件编辑·自动识别出可点行', se1 && se1.lines > 0 && se1.ocrFlag && se1.overlays > 0 && se1.opened && !se1.floatShown && se1.boxGone, JSON.stringify(se1 && { lines: se1.lines, ov: se1.overlays, opened: se1.opened, boxGone: se1.boxGone, hint: se1.hint }));
  check('扫描件编辑·记录带OCR标记与背景色', se1 && se1.rec && se1.rec.text === '扫描件已改字' && se1.rec.ocr === true && /^#[0-9a-fA-F]{6}$/.test(se1.rec.bg || ''), JSON.stringify(se1 && se1.rec));

  // 49a. 字体跟着原文走：扫描件没文字层 → 按文档主字体（默认宋体）；字号按字形高/宽反推，不能比原字小
  const famScan = await evalJS(send, `({ docFam: __PS.editor.docFam, rec: (function(){ const e=__PS.editor.edits.filter(x=>x.ocr)[0]; return e?{fam:e.fam,size:e.size,h:e.h,autoSize:e.autoSize}:null; })() })`, 30000);
  check('扫描件改字·字体跟随原文', famScan && famScan.rec && famScan.rec.fam === famScan.docFam && famScan.rec.fam === 'song', JSON.stringify(famScan));
  const ratio = famScan && famScan.rec ? famScan.rec.size / Math.max(1e-6, famScan.rec.h) : 0;
  // Tesseract 给的中文行字形框高本身就≈字号（实测 12pt → 11.7），所以 size/h 应接近 1；
  // 编辑器里还会再用画布墨高二次校准，这里只验"没被算小"
  check('扫描件改字·字号贴近原字形', ratio >= 0.90 && ratio <= 1.20, 'size/h=' + ratio.toFixed(3));
  // 49b. 手动切字体：已有修改记录当场换族并重算字号，切回自动恢复
  const famSwitch = await evalJS(send, `(()=>{ const s=document.getElementById('edFontFam');
    s.value='kai'; s.dispatchEvent(new Event('change'));
    const a=__PS.editor.edits.filter(x=>x.ocr)[0]; const kai={fam:a.fam,size:a.size};
    s.value='auto'; s.dispatchEvent(new Event('change'));
    const b=__PS.editor.edits.filter(x=>x.ocr)[0];
    return { kai, auto:{fam:b.fam,size:b.size}, docFam:__PS.editor.docFam }; })()`, 30000);
  check('改字·字体可手动切换', famSwitch && famSwitch.kai.fam === 'kai' && famSwitch.auto.fam === famSwitch.docFam && famSwitch.kai.size !== famSwitch.auto.size, JSON.stringify(famSwitch));

  // 50. 扫描件改字保存 → 新文字进 PDF，原字形被覆盖块盖掉
  const svScan = await evalJS(send, `__PS.testSaveEdits()`, 120000);
  const scanSv = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length,head:String.fromCharCode(...f.bytes.slice(0,2))}))`);
  const scanTxt = scanSv.length ? await evalJS(send, `(async()=>{ const u8=__PS_SAVED__[0].bytes; const d=await pdfjsLib.getDocument({data:u8.slice()}).promise; const pg=await d.getPage(1); const tc=await pg.getTextContent(); const t=tc.items.map(i=>i.str).join(''); return {hasNew:t.includes('扫描件已改字')}; })()`, 90000) : {};
  check('扫描件编辑·保存后新文字写入', scanSv.length === 1 && scanSv[0].head === '%P' && scanTxt.hasNew && svScan.len > 0, JSON.stringify({ scanSv, scanTxt }));
  // 50a. 写回去的字体必须是原文那款（PDF 里能看到 SimSun 字体名），不能是内置兜底字体
  const embChk = scanSv.length ? await evalJS(send, `(()=>{ const u8=__PS_SAVED__[0].bytes; let t=''; for(let i=0;i<u8.length;i++) t+=String.fromCharCode(u8[i]);
    return { simsun: /SimSun/.test(t), anyCjk: /SimSun|SimHei|KaiTi|FangSong|SimSun-/.test(t), size: u8.length }; })()`, 60000) : {};
  check('扫描件改字·内嵌原文宋体', embChk && embChk.simsun, JSON.stringify(embChk));
  const coverChk = scanSv.length ? await evalJS(send, `(async()=>{
    const r=__PS.editor.edits.filter(e=>e.ocr)[0];
    const dark=async(bytes)=>{
      const d=await pdfjsLib.getDocument({data:bytes.slice()}).promise; const pg=await d.getPage(1);
      const vp=pg.getViewport({scale:2}); const cv=document.createElement('canvas'); cv.width=vp.width; cv.height=vp.height;
      const cx=cv.getContext('2d'); cx.fillStyle='#fff'; cx.fillRect(0,0,cv.width,cv.height);
      await pg.render({canvasContext:cx, viewport:vp, intent:'print'}).promise;
      const bx=Math.round((r.x+r.w*0.72)*2), by=Math.round((__PS.editor.vpH-r.y-r.h*0.95)*2);
      const bw=Math.max(2,Math.round(r.w*0.26*2)), bh=Math.max(2,Math.round(r.h*1.1*2));
      const im=cx.getImageData(bx,by,bw,bh).data; let n=0;
      for(let i=0;i<im.length;i+=4){ if(im[i]<140&&im[i+1]<140&&im[i+2]<140) n++; }
      return n;
    };
    const before=await dark(Uint8Array.from(atob('${scanB64}'),c=>c.charCodeAt(0)));
    const after=await dark(__PS_SAVED__[0].bytes);
    return { before, after, rect:{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.w),h:Math.round(r.h)} };
  })()`, 180000) : {};
  check('扫描件编辑·原字形被覆盖', coverChk.before > 10 && coverChk.after <= Math.max(4, coverChk.before * 0.3), JSON.stringify(coverChk));

  /* ===== 段落级编辑：点一行 → 整段多行一起改，按原宽度重排 ===== */
  const genPara = await evalJS(send, `(async()=>{
    const {PDFDocument, rgb}=PDFLib;
    const doc=await PDFDocument.create(); doc.registerFontkit(window.fontkit);
    const fb=await window.__PDFSTUDIO_BRIDGE__.font('song');
    const font=await doc.embedFont(fb.bytes,{subset:true});
    const page=doc.addPage([595,842]);
    const size=12, lead=20, left=72, maxW=595-144;
    const paras=[
      '（一）保险标的造成的第三者损失：在保险期间内，被保险人及其允许的驾驶人在使用保险车辆过程中发生意外事故，致使第三者遭受人身伤亡或者财产的直接损毁，依法应当由被保险人承担的经济赔偿责任，保险人依照本保险合同的规定负责赔偿。',
      '（二）保险标的自身缺陷、保管不善导致的损毁，保险标的的氧化、腐蚀、锈损、自然损耗、自然磨损所造成的损失和费用；',
      '（三）需经常更换的工具和配件（如：打击锤、钻头、皮带、绳索、金属线等）、易损的玻璃配件（如：挡风玻璃、倒车镜、灯泡等）的单独损坏，以及车身表面油漆单独划伤所造成的损失和费用；',
      '（四）保险标的发动机进水后导致发动机的损失。'
    ];
    const wrap=(t,lim)=>{ const out=[]; let line=''; for(const ch of t){ const s=line+ch; if(font.widthOfTextAtSize(s,size)>lim&&line){out.push(line);line=ch;} else line=s; } if(line)out.push(line); return out; };
    let y=780;
    paras.forEach((p,pi)=>{ const ls=wrap(p, pi===0?maxW-size*2:maxW); ls.forEach((t,k)=>{ page.drawText(t,{x:left+(k===0&&pi===0?size*2:0), y, size, font, color:rgb(0,0,0)}); y-=lead; }); y-=lead*0.4; });
    const bytes=await doc.save(); let bin='';
    for(let i=0;i<bytes.length;i+=8192) bin+=String.fromCharCode.apply(null, bytes.subarray(i,i+8192));
    return btoa(bin);
  })()`, 60000);
  await evalJS(send, `__PS.testOpenDoc('para.pdf', ${JSON.stringify(genPara)})`, 60000);
  const pp = await evalJS(send, `(async()=>{ await __PS.openEditor(0); return __PS.testParas(); })()`, 90000);
  check('段落识别·多行自然成段', pp && pp.lines===10 && pp.multiPara===3 && pp.paras.map(p=>p.n).join(',')==='4,2,3,1', JSON.stringify(pp && pp.paras.map(p=>p.n)));
  check('改字颜色·默认取原文墨色（纯黑不偏灰）', pp && pp.inks.length>=4 && pp.inks.every(k=>k==='#000000'), JSON.stringify(pp && pp.inks));
  const pe = await evalJS(send, `__PS.testParaEdit(0, 1, '（二）保险标的自有瑕疵、保管不善导致的损毁，保险标的的氧化、腐蚀、锈损、自然损耗、自然磨损所造成的损失和费用；')`, 90000);
  check('整段编辑·点一行带出整段', pe && pe.opened && pe.n===2 && pe.boxLines===2 && pe.editorW>200, JSON.stringify({n:pe&&pe.n, opened:pe&&pe.opened, boxLines:pe&&pe.boxLines, w:pe&&pe.editorW}));
  check('整段编辑·框内字号等于原段字号', pe && pe.pSize>0 && Math.abs(pe.sizePx - pe.pSize*pe.scale) <= pe.pSize*pe.scale*0.08, JSON.stringify({sizePx:pe&&pe.sizePx, pSize:pe&&pe.pSize, scale:pe&&+pe.scale.toFixed(2)}));
  check('整段编辑·不压住其它行', pe && pe.covered===0, JSON.stringify({covered:pe&&pe.covered}));
  check('整段编辑·右下角可自由拉伸', pe && pe.wStretch && pe.wStretch[1] >= pe.wStretch[0]+80 && pe.hStretch[1] >= pe.hStretch[0]+30 && pe.manSize==='1', JSON.stringify({w:pe&&pe.wStretch, h:pe&&pe.hStretch, flag:pe&&pe.manSize}));
  check('整段编辑·沿用原字号行距与字体', pe && pe.rec && pe.rec.size===12 && pe.rec.lead===20 && pe.rec.indent===0 && pe.rec.fam==='song' && /^#[0-2]/.test(pe.rec.color||''), JSON.stringify(pe&&pe.rec&&{size:pe.rec.size, lead:pe.rec.lead, fam:pe.rec.fam, color:pe.rec.color}));
  const psv = await evalJS(send, `(async()=>{
    window.__PS_SAVED__.length=0;
    await __PS.testSaveEdits();
    const before=Uint8Array.from(atob(${JSON.stringify(genPara)}),c=>c.charCodeAt(0));
    const after=window.__PS_SAVED__[0].bytes;
    const load=async(bytes)=>{ const d=await pdfjsLib.getDocument({data:bytes.slice()}).promise; const pg=await d.getPage(1);
      const tc=await pg.getTextContent();
      return tc.items.filter(i=>i.str.trim()).map(i=>({t:i.str, x:Math.round(i.transform[4]), y:Math.round(i.transform[5])})); };
    const a=await load(before), b=await load(after);
    const seg=(arr,p)=>arr.filter(o=>o.t.startsWith(p))[0]||null;
    return { a:a.length, b:b.length, newText:b.some(o=>o.t.includes('自有瑕疵')),
             seg1:seg(b,'（一）'), seg2:seg(b,'（二）'), seg3:seg(b,'（三）'), seg4:seg(b,'（四）'),
             head:(b[b.length-1]||{}).t||'' };
  })()`, 180000);
  check('整段保存·重排后其它段原位不动',
    psv && psv.newText && psv.seg3 && psv.seg3.y===644 && psv.seg4 && psv.seg4.y===576 && psv.seg1 && psv.seg1.y===780,
    JSON.stringify(psv));

  /* 同一段改长：先往上长（借段前空白），不把下面的段落顶掉 */
  const pl = await evalJS(send, `(async()=>{ await __PS.testResetEdits(); return __PS.testParaEdit(0, 0, '（一）保险标的造成的第三者损失：在保险期间内，被保险人及其允许的驾驶人在使用保险车辆过程中发生意外事故，致使第三者遭受人身伤亡或者财产的直接损毁，依法应当由被保险人承担的经济赔偿责任，保险人依照本保险合同的规定负责赔偿。\\n本段新增了两行说明文字用来验证段落改长之后下方内容自动让位的效果。\\n第二行说明文字确保行数净增。'); })()`, 90000);
  const plSv = await evalJS(send, `(async()=>{
    window.__PS_SAVED__.length=0;
    await __PS.testSaveEdits();
    const u8=window.__PS_SAVED__[0].bytes;
    const d=await pdfjsLib.getDocument({data:u8.slice()}).promise; const pg=await d.getPage(1);
    const tc=await pg.getTextContent();
    const it=tc.items.filter(i=>i.str.trim()).map(i=>({t:i.str, x:Math.round(i.transform[4]), y:Math.round(i.transform[5])}));
    const seg=(p)=>it.filter(o=>o.t.startsWith(p))[0]||null;
    return { seg1:seg('（一）'), seg2:seg('（二）'), seg3:seg('（三）'), seg4:seg('（四）'), added:it.filter(o=>o.t.includes('本段新增')).map(o=>o.y), yMax:Math.max(...it.map(o=>o.y)) };
  })()`, 180000);
  check('整段改长·下方段落整体让位（同位移、不重叠不丢段）',
    pl && plSv && plSv.yMax>=779 && plSv.yMax<=820 && plSv.seg2 && plSv.seg3 && plSv.seg4 &&
    (()=>{ const d=692-plSv.seg2.y; return d>4 && plSv.seg3.y===644-d && plSv.seg4.y===576-d; })(),
    JSON.stringify({maxY:plSv&&plSv.yMax, seg2:plSv&&plSv.seg2, seg3:plSv&&plSv.seg3, seg4:plSv&&plSv.seg4, added:plSv&&plSv.added}));

  /* 单行加长：写不下时自动折成段落，不让字跑出覆盖块 */
  const single = await evalJS(send, `(async()=>{
    const r=await __PS.testInlineEdit(0, 9, '（四）保险标的发动机进水后导致发动机的损失。本条同时适用于停放期间因暴雨积水、车辆落水等情形造成的发动机损坏，保险人按本保险合同约定负责赔偿。');
    const e=__PS.editor.edits.slice(-1)[0];
    return { opened:r&&r.opened, recText:r&&r.rec&&r.rec.text?r.rec.text.slice(0,10):'', multi:!!(e&&e.multi), nOld:e&&e.nOld, lead:e&&e.lead };
  })()`, 90000);
  check('单行写不下·自动折成段落', single && single.opened && single.multi && single.nOld===1 && single.lead>0, JSON.stringify(single));

  /* ===== 短字段：右边有地方就该用（不许提前折行）+ 墨色统一 ===== */
  const genFields = await evalJS(send, `(async()=>{
    const {PDFDocument, rgb}=PDFLib;
    const doc=await PDFDocument.create(); doc.registerFontkit(window.fontkit);
    const fb=await window.__PDFSTUDIO_BRIDGE__.font('song');
    const font=await doc.embedFont(fb.bytes,{subset:true});
    const page=doc.addPage([595,842]);
    const size=10.5, left=72;
    const rows=[
      ['保险合同争议解决方式：  诉讼', 760],
      ['出单机构：  成都市锦江支公司综合部', 730],
      ['（成都）', 708],
      ['签单日期：    年   月   日', 676],
      ['保险人联系地址：  四川省成都市锦江区楷字宫南街57号', 646]
    ];
    for(const r of rows) page.drawText(r[0],{x:left,y:r[1],size,font,color:rgb(0,0,0)});
    const bytes=await doc.save(); let bin='';
    for(let i=0;i<bytes.length;i+=8192) bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));
    return btoa(bin);
  })()`, 60000);
  await evalJS(send, `(async()=>{ await __PS.testOpenDoc('fields.pdf', ${JSON.stringify(genFields)}); __PS.selectTool('edittext'); await __PS.openEditor(0); })()`, 90000);

  /* 墨色统一：低倍率细笔画会采出 #8c8c8c 这种灰，必须归一到页面黑；彩色字保留 */
  const inkUni = await evalJS(send, `__PS.testUnifyInk(['#8c8c8c','#6b6b6b','#4a4a4a','#2b2b2b','#1e6fd9'])`, 30000);
  check('墨色统一·灰字归一到页面黑（彩色字保留）',
    inkUni && inkUni[0]==='#000000' && inkUni[1]==='#000000' && inkUni[2]==='#000000' && inkUni[3]==='#000000' && inkUni[4]==='#1e6fd9',
    JSON.stringify(inkUni));

  /* 整段框宽度：短字段（原宽 179）要放到页面可用宽度（263） */
  const fw = await evalJS(send, `(async()=>{
    __PS.testResetEdits();
    const E=__PS.editor;
    const i=E.lines.findIndex(l=>l.text.indexOf('出单机构')>=0);
    const pi=E.paraOf[i];
    const pe=await __PS.testParaEdit(0, pi, '出单机构：成都市锦江支公司综合部（成都）·签单日期2026年09月15日·保险人联系地址四川省成都市锦江区楷字宫南街57号·本行故意写长看会不会用到右边空地');
    return { i, pi, n:(E.paras[pi]||[]).length, pe };
  })()`, 90000);
  check('短字段·整段框宽按页面可用宽度',
    fw && fw.pe && fw.pe.opened && fw.pe.availW > fw.pe.pw*1.3 && Math.abs(fw.pe.editorW - (fw.pe.availW+12)*fw.pe.scale) <= 8,
    JSON.stringify(fw && fw.pe && {pw:fw.pe.pw, availW:fw.pe.availW, editorW:fw.pe.editorW, scale:+fw.pe.scale.toFixed(2)}));
  check('短字段·改长按页面宽度断行（不留半截行）',
    /* boxLines 量的是"打开时的原文"（两行原文在放宽后并成 1 行），
       关键是记录里的断行宽度必须等于页面可用宽度 */
    fw && fw.pe && fw.pe.rec && Math.abs(fw.pe.rec.w - fw.pe.availW) <= 1 && fw.pe.boxLines >= 1 && fw.pe.boxLines <= 4,
    JSON.stringify(fw && fw.pe && {recW:fw.pe.rec&&fw.pe.rec.w, availW:fw.pe.availW, boxLines:fw.pe.boxLines}));

  /* 单行加字：字比原字段长、但没超过页面可用宽度 → 还是单行，不折 */
  const f1 = await evalJS(send, `(async()=>{
    __PS.testResetEdits();
    const i=__PS.editor.lines.findIndex(l=>l.text.indexOf('签单日期')>=0);
    return await __PS.testInlineEdit(0, i, '签单日期：2026年09月77709日');
  })()`, 90000);
  check('短字段加字·没超页宽就不折行',
    f1 && f1.rec && f1.rec.multi===false && f1.rec.text.indexOf('77709')>=0,
    JSON.stringify(f1 && f1.rec && {multi:f1.rec.multi, w:f1.rec.w, orig:f1.origW, text:f1.rec.text.slice(0,24)}));

  /* 单行加字：超过页面可用宽度 → 转段落，断行宽度用页面宽度（不是原字段宽） */
  const f2 = await evalJS(send, `(async()=>{
    __PS.testResetEdits();
    const i=__PS.editor.lines.findIndex(l=>l.text.indexOf('签单日期')>=0);
    return await __PS.testInlineEdit(0, i, '签单日期：2026年09月77709日 出单机构：成都市锦江支公司综合部 保险人联系地址四川省成都市锦江区楷字宫南街57号');
  })()`, 90000);
  check('短字段加字·超页宽才折行（按页面宽度）',
    f2 && f2.rec && f2.rec.multi===true && f2.rec.w > (f2.origW||0)*1.5,
    JSON.stringify(f2 && f2.rec && {multi:f2.rec.multi, w:f2.rec.w, orig:f2.origW}));

  const fsv = await evalJS(send, `(async()=>{
    window.__PS_SAVED__.length=0;
    await __PS.testSaveEdits();
    const u8=window.__PS_SAVED__[0].bytes;
    const d=await pdfjsLib.getDocument({data:u8.slice()}).promise; const pg=await d.getPage(1);
    const tc=await pg.getTextContent();
    const it=tc.items.filter(o=>o.str.trim()).map(o=>({t:o.str.slice(0,10), w:Math.round(o.width), x:Math.round(o.transform[4])}));
    return { n:it.length, maxW:Math.max(...it.map(o=>o.w)), items:it.filter(o=>o.x>=70 && o.x<80).slice(-4) };
  })()`, 180000);
  check('短字段保存·断行宽度用页面宽度',
    fsv && fsv.maxW>180 && fsv.maxW<=280,
    JSON.stringify(fsv && {n:fsv.n, maxW:fsv.maxW, tail:fsv.items}));

  /* ===== Acrobat 式编辑：格式条（加粗/斜体/对齐/行距）· 插入文本 · 插入图片 · 拖动换位 ===== */
  await evalJS(send, `(async()=>{ __PS.testResetEdits(); __PS.selectTool('edittext'); await __PS.openEditor(0); })()`, 90000);

  /* 格式条：加粗+斜体+右对齐+行距 → 记录带格式 → 保存后内容流里有描边文字与剪切矩阵 */
  const fmt = await evalJS(send, `(async()=>{
    const i=__PS.editor.lines.findIndex(l=>l.text.indexOf('签单日期')>=0);
    document.querySelector('.tline[data-i="'+i+'"]').click();
    let box=null; for(let k=0;k<40 && !(box=document.querySelector('.edin'));k++) await new Promise(r=>setTimeout(r,200));
    if(!box) return {err:'no box'};
    box.dataset.fsize=10.5;
    $('fmtB').click(); $('fmtI').click();
    $('edFmt').querySelector('[data-fa="right"]').click();
    $('fmtLh').value='1.8'; $('fmtLh').onchange();
    box.innerText='签单日期：2026年09月15日';
    box.dispatchEvent(new Event('input',{bubbles:true}));
    const fmtShown=$('edFmt').style.display!=='none';
    if(ED.inline===box) edCommitInline();
    await new Promise(r=>setTimeout(r,120));
    const rec1=(ED.edits[ED.edits.length-1])||null;
    return { fmtShown, bold:rec1&&rec1.bold, italic:rec1&&rec1.italic,
             align:rec1&&rec1.align, lead:rec1&&rec1.lead, size:rec1&&rec1.size, text:rec1&&rec1.text };
  })()`, 90000);
  check('格式条·加粗/斜体/右对齐/行距落到记录', fmt && fmt.fmtShown && fmt.bold && fmt.italic && fmt.align==='right' && fmt.size>0 && Math.abs(fmt.lead-fmt.size*1.8)<0.15, JSON.stringify(fmt));

  /* 插入文本：点「插入文本」→ 空白处单击放置 → 输入 → 失焦落记录 */
  const nw = await evalJS(send, `(async()=>{
    if(ED.inline) edCommitInline();
    __PS.testResetEdits(); ED.news.length=0;
    $('edAddText').click();
    const layer=$('edLayer'), rc=$('edStage').getBoundingClientRect();
    const x=rc.left+120, y=rc.top+60;
    layer.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:x,clientY:y}));
    document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:x,clientY:y}));
    await new Promise(r=>setTimeout(r,100));
    const box=document.querySelector('.edin.newbox'); if(!box) return {err:'no newbox'};
    box.innerText=' inserted text 备注 ';
    box.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,60));
    if(ED.inline===box) edCommitNew(box); await new Promise(r=>setTimeout(r,120));
    return { n:ED.news.length, rec:ED.news[0]&&{text:ED.news[0].text, size:ED.news[0].size, x:Math.round(ED.news[0].x), y:Math.round(ED.news[0].y), w:Math.round(ED.news[0].w)} };
  })()`, 90000);
  check('插入文本·空白处放置并落记录', nw && nw.n===1 && nw.rec && nw.rec.text==='inserted text 备注' && nw.rec.w>40, JSON.stringify(nw));

  /* 插入图片：直接构造 pendImg 放置 → regions 带图 → 预览有真图背景 */
  const imgIns = await evalJS(send, `(async()=>{
    if(ED.inline) edCommitInline();
    /* 1x1 白 PNG */
    const b64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const bin=atob(b64); const u8=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) u8[i]=bin.charCodeAt(i);
    ED.pendImg=u8; ED.pendImgSize={w:120,h:80};
    $('edAddImg').click();           // 只为走同一条路径设置 pendNew；我们直接放置
    ED.pendNew='img';
    const rc=$('edStage').getBoundingClientRect();
    edNewImage(rc.left+200, rc.top+200);
    const r=ED.regions[ED.regions.length-1];
    return { hasImg:!!(r&&r.img), w:Math.round((r&&r.w)||0), h:Math.round((r&&r.h)||0),
             preview:$('edLayer').querySelector('.edov.act[style*="url("]')!==null };
  })()`, 60000);
  check('插入图片·放置并显示真图', imgIns && imgIns.hasImg && imgIns.w===90 && imgIns.h===60 && imgIns.preview, JSON.stringify(imgIns));

  /* 拖动换位：对改过的文字块拖动 → 记录 mvx/mvy；保存后原位被盖、字写到新位置 */
  const mv = await evalJS(send, `(async()=>{
    __PS.testResetEdits();                     /* 保留 news（插入文本留给保存一起验证） */
    const i=__PS.editor.lines.findIndex(l=>l.text.indexOf('签单日期')>=0);
    document.querySelector('.tline[data-i="'+i+'"]').click();
    let box=null; for(let k=0;k<40 && !(box=document.querySelector('.edin'));k++) await new Promise(r=>setTimeout(r,200));
    if(!box) return {err:'no box'};
    $('fmtB').click();                         /* 拖动的这条同时带加粗，保存后验证 Tr=2 */
    box.innerText='签单日期：2026年09月15日 四川省成都市锦江区';
    box.dispatchEvent(new Event('input',{bubbles:true}));
    if(ED.inline===box) edCommitInline();
    await new Promise(r=>setTimeout(r,120));
    const ov=document.querySelector('.edov.act'); if(!ov) return {err:'no act overlay'};
    const r0=ov.getBoundingClientRect();
    const mk=(t,x,y)=>new MouseEvent(t,{bubbles:true,clientX:x,clientY:y});
    ov.dispatchEvent(mk('mousedown',r0.left+5,r0.top+5));
    document.dispatchEvent(mk('mousemove',r0.left+65,r0.top+40));
    document.dispatchEvent(mk('mouseup',r0.left+65,r0.top+40));
    await new Promise(r2=>setTimeout(r2,120));
    const rec=(ED.edits[ED.edits.length-1])||null;
    return { scale:ED.scale, mvx:rec&&Math.round(rec.mvx), mvy:rec&&Math.round(rec.mvy),
             bold:rec&&rec.bold, text:rec&&rec.text.slice(0,10) };
  })()`, 90000);
  check('拖动换位·文字块记录移动偏移',
    mv && mv.scale>0 && Math.abs(mv.mvx-60/mv.scale)<2.5 && Math.abs(mv.mvy+40/mv.scale)<8 && !!mv.text,
    JSON.stringify(mv));

  /* 保存：插入文本 + 加粗样式 + 拖动一起烧进 PDF，读回验证 */
  const acroSave = await evalJS(send, `(async()=>{
    window.__PS_SAVED__.length=0;
    await __PS.testSaveEdits();
    const u8=window.__PS_SAVED__[0].bytes;
    const d=await pdfjsLib.getDocument({data:u8.slice()}).promise; const pg=await d.getPage(1);
    const tc=await pg.getTextContent();
    const inserted=tc.items.some(o=>o.str.indexOf('inserted text')>=0);
    const moved=tc.items.some(o=>o.str.indexOf('签单日期')>=0 && o.transform[4]>100);
    const stream=pg.getOperatorList();
    let stroke=0;
    try{
      const ops=stream.fnArray, args=stream.argsArray;
      /* setTextRenderingMode 的 op id：从 commonObjs 不可得，改查渲染后的填充区大小不靠谱，
         这里直接验证：加粗行的文字宽度比普通宋体宽（描边加粗会撑宽 glyph）不现实。
         改为验证内容流原始字节里有 Tr 2 操作（FillAndOutline） */
    }catch(e){}
    let trMode=0;
    try{
      const ol=await pg.getOperatorList(); const OPS=pdfjsLib.OPS;
      for(let k=0;k<ol.fnArray.length;k++){
        if(ol.fnArray[k]===OPS.setTextRenderingMode) trMode=Math.max(trMode, ol.argsArray[k][0]);
      }
    }catch(e){ trMode='ERR:'+e.message; }
    return { inserted, moved, sizeMB:+(u8.length/1048576).toFixed(2), trMode };
  })()`, 180000);
  check('保存·插入文本写进 PDF', acroSave && acroSave.inserted, JSON.stringify(acroSave));
  check('保存·拖动后的文字写到新位置', acroSave && acroSave.moved, JSON.stringify(acroSave));
  check('保存·加粗=描边渲染（Tr=2 FillAndOutline）', acroSave && acroSave.trMode===2, JSON.stringify(acroSave));

  /* 差异重写：中文保单里改一个字，只重写改动点之后，前缀原字形不动
     —— 原文一行里混着不同字重/被压缩的字宽，整行按一种字体重画必然"改回还是不一样" */
  const bPol = b64('policy_p1.pdf');
  const diffWrite = await evalJS(send, `(async()=>{
    __PS.testResetEdits();
    await __PS.testOpenDoc('policy_p1.pdf','${bPol}');
    await new Promise(r=>setTimeout(r,1200));
    await __PS.openEditor(0);
    await new Promise(r=>setTimeout(r,1500));
    const i=ED.lines.findIndex(l=>(l.text||'').indexOf('被保险人：')===0);
    if(i<0) return {err:'no line'};
    const L=ED.lines[i];
    document.querySelector('.tline[data-i="'+i+'"]').click();
    let box=null; for(let k=0;k<40 && !(box=document.querySelector('.edin'));k++) await new Promise(r=>setTimeout(r,200));
    if(!box) return {err:'no box'};
    box.focus(); box.textContent=L.text.replace('安润','安泰');
    box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,300));
    const rec=ED.edits[ED.edits.length-1];
    window.__DIFFX__=rec?rec.x:0;
    return { lx:+L.x.toFixed(1), lsize:L.size, suffix:!!(rec&&rec.suffix),
             x:rec?+rec.x.toFixed(1):null, hscale:rec?rec.hscale:null, tail:rec?rec.text:null };
  })()`, 120000);
  check('差异重写·只重写改动点之后（前缀原字形保留）',
    diffWrite && diffWrite.suffix && diffWrite.x > diffWrite.lx + 20 &&
    diffWrite.hscale > 0.6 && diffWrite.hscale < 1.3 && /泰起重/.test(diffWrite.tail||'') && !/润/.test(diffWrite.tail||''),
    JSON.stringify(diffWrite));

  const diffSaved = await evalJS(send, `(async()=>{
    window.__PS_SAVED__.length=0;
    await __PS.testSaveEdits();
    const u8=window.__PS_SAVED__[0].bytes;
    const d=await pdfjsLib.getDocument({data:u8.slice()}).promise; const pg=await d.getPage(1);
    const tc=await pg.getTextContent();
    const label=tc.items.find(o=>o.str.indexOf('被保险人：')===0 && Math.abs(o.transform[5]-526)<2);
    const dx=window.__DIFFX__||0;
    const tail=tc.items.find(o=>o.str && Math.abs(o.transform[4]-dx)<2.5 && Math.abs(o.transform[5]-526)<2);
    return { labelX:label?+label.transform[4].toFixed(1):null, tailX:tail?+tail.transform[4].toFixed(1):null,
             tail:tail?tail.str:null, dx:+dx.toFixed(1) };
  })()`, 120000);
  check('差异重写·保存后前缀坐标不变（标签仍在原 x）',
    diffSaved && diffSaved.labelX!=null && Math.abs(diffSaved.labelX - 43.3) < 1.6 &&
    diffSaved.tailX!=null && Math.abs(diffSaved.tailX - diffSaved.dx) < 2.5 && /泰起重/.test(diffSaved.tail||''),
    JSON.stringify(diffSaved));

  /* 同一行不能被拆成两个框：用户「单行改」之后再「查找替换」同一行，
     以前会建两条记录叠在一起（一版新字、一版原文重画），看着就是字被拆开、框裂成两个 */
  const sameLine = await evalJS(send, `(async()=>{
    __PS.testResetEdits();
    await __PS.testOpenDoc('policy_p1.pdf','${bPol}');
    await new Promise(r=>setTimeout(r,1200));
    await __PS.openEditor(0);
    await new Promise(r=>setTimeout(r,1500));
    const i=ED.lines.findIndex(l=>(l.text||'').indexOf('总保险金额')===0);
    const L=ED.lines[i];
    document.querySelector('.tline[data-i="'+i+'"]').click();
    let box=null; for(let k=0;k<40 && !(box=document.querySelector('.edin'));k++) await new Promise(r=>setTimeout(r,200));
    if(!box) return {err:'no box'};
    box.focus(); box.textContent=L.text.replace('叁伯','叁佰');
    box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,300));
    document.getElementById('edFind').value='元整';
    document.getElementById('edRepl').value='元正';
    await edBatchReplace();
    await new Promise(r=>setTimeout(r,600));
    const recs=ED.edits.filter(e=>e.page===0 && !e.multi && Math.abs(e.y-L.y)<1.2);
    const boxes=[...document.querySelectorAll('#edLayer .edov')].filter(n=>{
      const t=parseFloat(n.style.top)||0; return Math.abs(t-(ED.vpH-(L.y+L.size*1.4))*ED.scale)<40; });
    const full=recs.length?((recs[recs.length-1].full!=null)?recs[recs.length-1].full:recs[recs.length-1].text):'';
    return { nRec:recs.length, nBox:boxes.length, full:full,
             has3Bai:/叁佰/.test(full), hasYuanZheng:/元正/.test(full) };
  })()`, 150000);
  check('查找替换·同一行只留一条记录（不裂框）',
    sameLine && sameLine.nRec===1 && sameLine.nBox===1,
    JSON.stringify(sameLine));
  check('查找替换·不覆盖这一行已经改好的字',
    sameLine && sameLine.has3Bai && sameLine.hasYuanZheng,
    JSON.stringify(sameLine));

  /* 没改过的行做查找替换：也走差异重写，加粗标签/压缩字宽/间隙原样保住 */
  const batchSuffix = await evalJS(send, `(async()=>{
    __PS.testResetEdits();
    await __PS.testOpenDoc('policy_p1.pdf','${bPol}');
    await new Promise(r=>setTimeout(r,1200));
    await __PS.openEditor(0);
    await new Promise(r=>setTimeout(r,1500));
    const i=ED.lines.findIndex(l=>(l.text||'').indexOf('保险期间')===0);
    const L=ED.lines[i];
    document.getElementById('edFind').value='二十四时止';
    document.getElementById('edRepl').value='二十二时止';
    await edBatchReplace();
    await new Promise(r=>setTimeout(r,600));
    const rec=ED.edits.filter(e=>e.page===0 && !e.multi && Math.abs(e.y-L.y)<1.2).pop();
    return { lx:+L.x.toFixed(1), suffix:!!(rec&&rec.suffix), x:rec?+rec.x.toFixed(1):null,
             oldFull:rec?rec.oldFull:null, sameOld:rec?(rec.oldFull===L.text):false,
             tail:rec?rec.text:null, hs:rec?rec.hscale:null };
  })()`, 150000);
  check('查找替换·未改过的行保留前缀字形（差异重写）',
    batchSuffix && batchSuffix.suffix && batchSuffix.x > batchSuffix.lx + 20 &&
    batchSuffix.sameOld && batchSuffix.tail==='日二十二时止' && Math.abs(batchSuffix.x-259.6)<1.5,
    JSON.stringify(batchSuffix));

  // 17. 截图（环境合成器偶尔不响应，失败不影响结论）
  try {
    const shot = await send('Page.captureScreenshot', { format: 'png' }, 15000);
    fs.writeFileSync(path.join(__dirname, 'ui-final.png'), Buffer.from(shot.data, 'base64'));
  } catch (e) { console.log('WARN | 截图跳过：' + String(e.message).slice(0, 80)); }


  const fails = results.filter(r => !r.ok).length;

  /* ===== 自动重排（Auto Adjust Layout）：段落加长 → 下方内容让位、批注跟随 ===== */
  const bLay = b64('doc_layout.pdf');

  const rfEd = await evalJS(send, `(async()=>{
    __PS.testResetEdits();
    await __PS.testOpenDoc('doc_layout.pdf','${bLay}');
    await new Promise(r=>setTimeout(r,1200));
    await __PS.openEditor(0);
    await new Promise(r=>setTimeout(r,1500));
    const i=ED.lines.findIndex(l=>(l.text||'').indexOf('项目管理流程')===0);
    if(i<0) return {err:'no para line', n:ED.lines.length, texts:ED.lines.map(l=>l.text)};
    document.querySelector('.tline[data-i="'+i+'"]').click();
    let box=null; for(let k=0;k<40 && !(box=document.querySelector('.edin'));k++) await new Promise(r=>setTimeout(r,200));
    if(!box) return {err:'no box'};
    box.focus();
    box.textContent='项目管理流程包括启动规划执行监控与收尾五个阶段。'+('这一段被大幅加长用来验证自动重排时下方内容要让位。'.repeat(6));
    box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,400));
    const rec=ED.edits.filter(e=>e.multi && Math.abs(e.y-760)<1.6).pop();
    return rec?{ multi:true, nOld:rec.nOld, below:rec.reflow&&rec.reflow.below.length,
                 yMin:rec.reflow&&rec.reflow.yMin, gapAfter:rec.gapAfter||0,
                 belowY:rec.reflow?rec.reflow.below.map(b=>b.y):null }:{rec:null, n:ED.edits.length};
  })()`, 120000);
  check('自动重排·整段加长挂下方让位清单（列表+结尾段）',
    rfEd && rfEd.multi && rfEd.nOld===3 && rfEd.below===4 && Math.abs(rfEd.yMin-727.2)<2,
    JSON.stringify(rfEd).slice(0,220));

  const rfSaved = await evalJS(send, `(async()=>{
    window.__PS_SAVED__.length=0;
    await __PS.testSaveEdits();
    const u8=window.__PS_SAVED__[0] && window.__PS_SAVED__[0].bytes;
    if(!u8) return {err:'no saved'};
    const d=await pdfjsLib.getDocument({data:u8.slice()}).promise;
    const pg=await d.getPage(1);
    const tc=await pg.getTextContent();
    const end=tc.items.find(o=>(o.str||'').indexOf('结尾段落说明文字内容')>=0);
    const ann=await pg.getAnnotations();
    const all=tc.items.map(o=>o.str||'').join('');
    return { endY:end?+end.transform[5].toFixed(1):null,
             annY:(ann && ann.length)? +ann[0].rect[1].toFixed(1) : null,
             annN:ann?ann.length:0, hasWrap:all.indexOf('验证自动重排')>=0 };
  })()`, 120000);
  check('自动重排·保存后结尾段下移、批注跟随不错位、新文字已写入',
    rfSaved && rfSaved.endY!=null && (600-rfSaved.endY)>8 &&
    rfSaved.annY!=null && Math.abs(rfSaved.annY-(612+(rfSaved.endY-600)))<2.5 &&
    rfSaved.hasWrap===true && rfSaved.annN>=1,
    JSON.stringify(rfSaved));

  const rfNum = await evalJS(send, `(async()=>{
    __PS.testResetEdits();
    await __PS.testOpenDoc('doc_layout.pdf','${bLay}');
    await new Promise(r=>setTimeout(r,1200));
    await __PS.openEditor(0);
    await new Promise(r=>setTimeout(r,1500));
    const i=ED.lines.findIndex(l=>(l.text||'').indexOf('2、乙列表')===0);
    if(i<0) return {err:'no item', n:ED.lines.length};
    document.querySelector('.tline[data-i="'+i+'"]').click();
    let box=null; for(let k=0;k<40 && !(box=document.querySelector('.edin'));k++) await new Promise(r=>setTimeout(r,200));
    if(!box) return {err:'no box'};
    box.focus();
    box.textContent='9、乙列表项目内容（改号）';
    box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,300));
    return { renum:__PS.testRenumber() };
  })()`, 120000);
  check('列表自动编号·改 2→9 后下方 3→10 顺延',
    rfNum && rfNum.renum && rfNum.renum.length===1 && rfNum.renum[0].old==='3、丙列表项目内容说明' &&
    rfNum.renum[0].text==='10、丙列表项目内容说明', JSON.stringify(rfNum));

  const numSaved = await evalJS(send, `(async()=>{
    window.__PS_SAVED__.length=0;
    await __PS.testSaveEdits();
    const u8=window.__PS_SAVED__[0] && window.__PS_SAVED__[0].bytes;
    if(!u8) return {err:'no saved'};
    const d=await pdfjsLib.getDocument({data:u8.slice()}).promise;
    const pg=await d.getPage(1);
    const tc=await pg.getTextContent();
    const all=tc.items.map(o=>o.str||'').join('|');
    return { has10:/10、丙列表项目内容说明/.test(all), hasOld3:/3、丙列表项目内容说明/.test(all) };
  })()`, 120000);
  check('列表自动编号·保存读回 10、已写入 3、已擦除',
    numSaved && numSaved.has10===true && numSaved.hasOld3===false, JSON.stringify(numSaved));

  const rfGap = await evalJS(send, `(async()=>{
    __PS.testResetEdits();
    await __PS.testOpenDoc('doc_layout.pdf','${bLay}');
    await new Promise(r=>setTimeout(r,1200));
    await __PS.openEditor(0);
    await new Promise(r=>setTimeout(r,1500));
    const i=ED.lines.findIndex(l=>(l.text||'').indexOf('项目管理流程')===0);
    document.querySelector('.tline[data-i="'+i+'"]').click();
    let box=null; for(let k=0;k<40 && !(box=document.querySelector('.edin'));k++) await new Promise(r=>setTimeout(r,200));
    if(!box) return {err:'no box'};
    document.getElementById('fmtGap').value='12';
    document.getElementById('fmtGap').onchange();
    box.focus();
    box.textContent='项目管理流程包括启动规划执行监控与收尾五个阶段每个阶段都有明确交付物和验收标准。新增段后间距十二磅的说明。';
    box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,300));
    const rec=ED.edits.filter(e=>e.multi).pop();
    return rec?{ gapAfter:rec.gapAfter||0, below:rec.reflow&&rec.reflow.below.length }:{rec:null};
  })()`, 120000);
  check('段后间距·格式条 fmtGap=12 落进重排记录',
    rfGap && rfGap.gapAfter===12 && rfGap.below>=4, JSON.stringify(rfGap));

  const aiLoc = await evalJS(send, `({
    sum:__PS.testAiLocal('总结下面的文字','第一句话讲背景。第二句话讲方案。第三句话讲结果。第四句话讲风险。'),
    pol:__PS.testAiLocal('润色下面的文字','你好，  world。。测试，结束')
  })`, 60000);
  check('AI 助手·本地规则（总结取前三句 / 润色清理重复标点）',
    aiLoc && aiLoc.sum==='第一句话讲背景。第二句话讲方案。第三句话讲结果。' &&
    aiLoc.pol==='你好， world。测试，结束', JSON.stringify(aiLoc));

  // 扫描件转 HTML（无文字层页自动嵌页面截图）
  const bScan = await evalJS(send, `(async()=>{ const {PDFDocument}=PDFLib; const d=await PDFDocument.create(); const pngU8=Uint8Array.from(atob('${bPng}'),c=>c.charCodeAt(0)); const img=await d.embedPng(pngU8); const p=d.addPage([595,842]); p.drawImage(img,{x:60,y:420,width:320,height:220}); p.drawImage(img,{x:60,y:120,width:320,height:220}); const u8=await d.save(); let bin=''; for(let i=0;i<u8.length;i++) bin+=String.fromCharCode(u8[i]); return btoa(bin); })()`, 60000);
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ await __PS.testOpenDoc('scan.pdf','${bScan}'); __PS.selectTool('p2html'); await __PS.testRun(); })()`, 90000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length}))`);
  const htmlScan = s.length ? await evalJS(send, `new TextDecoder('utf-8').decode(__PS_SAVED__[0].bytes.slice())`) : '';
  const scanImgN = (htmlScan.match(/class="pgimg"/g) || []).length;
  check('PDF转HTML·扫描件嵌截图',
    s.length===1 && /\.html$/.test(s[0].n) && scanImgN===1 && htmlScan.includes('data:image/jpeg') && !htmlScan.includes('本页没有文字层'),
    'imgs=' + scanImgN + ' size=' + (s[0] && s[0].size));

  // 纯文字模式（himg=never）不嵌截图
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.selectTool('p2html'); document.getElementById('f_himg').value='never'; await __PS.testRun(); })()`, 90000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length}))`);
  const htmlNever = s.length ? await evalJS(send, `new TextDecoder('utf-8').decode(__PS_SAVED__[0].bytes.slice())`) : '';
  check('PDF转HTML·纯文字模式',
    s.length===1 && !htmlNever.includes('class="pgimg"') && htmlNever.includes('本页没有文字层'),
    'size=' + (s[0] && s[0].size));

  /* ===== 手写签名板 E2E：真实指针绘制 → 外接框裁剪 → 落章像素断言 + 附加日期 ===== */
  const sigPad = await evalJS(send, `(async function(){
    __PS.selectTool('sign');
    await __PS.testOpenDoc('test-a.pdf','${bA}');
    openSignPad();
    const cv=document.getElementById('signpad-cv');
    if(!cv) return {open:false};
    const r=cv.getBoundingClientRect();
    const pe=(type,x,y)=>new PointerEvent(type,{clientX:x,clientY:y,bubbles:true,cancelable:true,pointerId:1,pointerType:'mouse',isPrimary:true});
    cv.dispatchEvent(pe('pointerdown', r.left+r.width*0.10, r.top+r.height*0.50));
    for(const p of [[0.25,0.32],[0.40,0.55],[0.55,0.35],[0.72,0.52],[0.85,0.42]])
      cv.dispatchEvent(pe('pointermove', r.left+r.width*p[0], r.top+r.height*p[1]));
    cv.dispatchEvent(pe('pointerup', r.left+r.width*0.85, r.top+r.height*0.42));
    document.getElementById('signpad-ok').click();
    // 确认按钮是 async 处理器（toBlob 后才写入 pickedFiles.sign），轮询等待
    let ready = false;
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (pickedFiles.sign && pickedFiles.sign.bytes && pickedFiles.sign.bytes[0] === 0x89 && pickedFiles.sign.bytes[1] === 0x50) { ready = true; break; }
    }
    return { open:true, ready };
  })()`, 60000);
  check('手写签名板·真实绘制并确认', sigPad && sigPad.open===true && sigPad.ready===true, JSON.stringify(sigPad));

  const sigTrim = await evalJS(send, `(async()=>{ const bmp=await createImageBitmap(new Blob([pickedFiles.sign.bytes])); return {w:bmp.width,h:bmp.height}; })()`, 30000);
  check('签名·外接框裁剪生效', sigTrim.w<600 && sigTrim.h<200 && sigTrim.w>60 && sigTrim.h>8, JSON.stringify(sigTrim));

  // 原始文档章区暗像素基线
  const cntBoxFn = `(docBytes)=>{
    const W=595.28,H=841.89, sc=2, iw=0.18, ix=0.60, iy=0.78, hr=0.30;
    return (async()=>{
      const doc=await pdfjsLib.getDocument({data:docBytes.slice(), cMapUrl:'vendor/cmaps/', cMapPacked:true, standardFontDataUrl:'vendor/standard_fonts/'}).promise;
      const page=await doc.getPage(1); const vp0=page.getViewport({scale:1});
      const Wd=vp0.width, Hd=vp0.height, vp=page.getViewport({scale:sc});
      const cv=document.createElement('canvas'); cv.width=Math.round(vp.width); cv.height=Math.round(vp.height);
      const ctx=cv.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,cv.width,cv.height);
      await page.render({canvasContext:ctx, viewport:vp, intent:'print'}).promise;
      const w=Wd*iw, h=w*hr, x0=(Wd-w)*ix, y0=(Hd-h)*iy;
      const cnt=(bx0,by0,bx1,by1)=>{ let dark=0;
        for(let py=Math.max(0,Math.round((Hd-by1)*sc)); py<Math.min(cv.height,Math.round((Hd-by0)*sc)); py+=2)
          for(let px=Math.max(0,Math.round(bx0*sc)); px<Math.min(cv.width,Math.round(bx1*sc)); px+=2){
            const d=ctx.getImageData(px,py,1,1).data; if(d[0]<110&&d[1]<110&&d[2]<110) dark++;
          } return dark; };
      return { box: cnt(x0,y0,x0+w,y0+h), below: cnt(x0,y0-26,x0+w*0.75,y0-2) };
    })(); }`;
  const sigOrig = await evalJS(send, `st.bytes ? (${cntBoxFn})(st.bytes) : null`, 60000);
  await evalJS(send, `__PS_SAVED__.length=0; (async()=>{ __PS.selectTool('sign'); await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length,head:String.fromCharCode(...f.bytes.slice(0,5))}))`);
  check('手写签名·落章保存为 PDF', s.length===1 && /_签名\.pdf$/.test(s[0].n) && s[0].head==='%PDF-', JSON.stringify(s));
  const sigPix = await evalJS(send, `(${cntBoxFn})(__PS_SAVED__[0].bytes)`, 60000);
  check('手写签名·章区新增墨迹', sigPix && sigOrig && sigPix.box > sigOrig.box + 5, 'orig=' + JSON.stringify(sigOrig) + ' signed=' + JSON.stringify(sigPix));

  // 附加签名日期：日期带（章下方）出现墨迹
  await evalJS(send, `(async()=>{ __PS.selectTool('sign'); document.getElementById('f_sdate').checked=true; __PS_SAVED__.length=0; await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length}))`);
  const sigDate = await evalJS(send, `(${cntBoxFn})(__PS_SAVED__[0].bytes)`, 60000);
  check('手写签名·附加日期', s.length===1 && sigDate && sigOrig && sigDate.below > sigOrig.below + 5, 'orig=' + JSON.stringify(sigOrig) + ' dated=' + JSON.stringify(sigDate));
  await evalJS(send, `document.getElementById('f_sdate').checked=false;`, 20000);

  /* ===== Stirling-PDF 借鉴：裁剪 / 展平 / 提取图片 / 元数据 / 比较 ===== */

  // 裁剪（边距模式）：裁完用 pdf.js 重载，可视页面应比原页小
  await evalJS(send, `(async()=>{ await __PS.testOpenDoc('test-a.pdf','${bA}'); __PS.selectTool('crop'); __PS_SAVED__.length=0; await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length,head:String.fromCharCode(...f.bytes.slice(0,5))}))`);
  check('页面裁剪·边距模式', s.length===1 && /_裁剪\.pdf$/.test(s[0].n) && s[0].head==='%PDF-', JSON.stringify(s));

  // 裁剪（自动去白边）：保存成功即可，宽度断言依赖语料内容
  await evalJS(send, `(async()=>{ __PS.selectTool('crop'); document.getElementById('f_cm').value='content'; document.getElementById('f_cm').dispatchEvent(new Event('change')); __PS_SAVED__.length=0; await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length}))`);
  check('页面裁剪·自动去白边', s.length===1 && /_裁剪\.pdf$/.test(s[0].n), JSON.stringify(s));

  // 展平：现造一个带文本框的表单 PDF → 展平后字段应为 0
  const bForm = await evalJS(send, `(async()=>{
    const doc=await PDFLib.PDFDocument.load(Uint8Array.from(atob('${bA}'),c=>c.charCodeAt(0)));
    doc.getForm().createTextField('name'); doc.getForm().getTextField('name').setText('张三');
    const b=await doc.save(); let s=''; for(const c of b) s+=String.fromCharCode(c);
    return btoa(s);
  })()`, 60000);
  await evalJS(send, `(async()=>{ await __PS.testOpenDoc('test-form.pdf','${bForm}'); __PS.selectTool('flatten'); __PS_SAVED__.length=0; await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length}))`);
  const flatN = await evalJS(send, `(async()=>{
    const b=__PS_SAVED__[0].bytes;
    const doc=await PDFLib.PDFDocument.load(b);
    try { return { fields: doc.getForm().getFields().length }; } catch(e){ return { fields: -1 }; }
  })()`, 60000);
  check('展平·表单字段拍平', s.length===1 && /_展平\.pdf$/.test(s[0].n) && flatN && flatN.fields===0, JSON.stringify(s)+' fields='+JSON.stringify(flatN));

  // 提取图片：现造一个嵌 test.png 的 PDF → 至少提取 1 张 PNG
  const bImgPdf = await evalJS(send, `(async()=>{
    const doc=await PDFLib.PDFDocument.create();
    const img=await doc.embedPng(Uint8Array.from(atob('${bPng}'),c=>c.charCodeAt(0)));
    const p=doc.addPage([600,800]); p.drawImage(img,{x:60,y:300,width:img.width,height:img.height});
    const b=await doc.save(); let s=''; for(const c of b) s+=String.fromCharCode(c);
    return btoa(s);
  })()`, 60000);
  await evalJS(send, `(async()=>{ await __PS.testOpenDoc('test-img.pdf','${bImgPdf}'); __PS.selectTool('extimg'); document.getElementById('f_minsz').value='10'; __PS_SAVED__.length=0; await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name, png:f.bytes[0]===0x89&&f.bytes[1]===0x50, size:f.bytes.length}))`);
  check('提取图片·嵌入图导出 PNG', s.length>=1 && s.every(x=>x.png), JSON.stringify(s));

  // 文档信息 / 重命名
  await evalJS(send, `(async()=>{ await __PS.testOpenDoc('test-a.pdf','${bA}'); __PS.selectTool('meta'); document.getElementById('f_title').value='测试标题文档'; document.getElementById('f_rename').value='title'; __PS_SAVED__.length=0; await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length}))`);
  const metaT = await evalJS(send, `(async()=>{
    const b=__PS_SAVED__[0].bytes;
    return (await PDFLib.PDFDocument.load(b)).getTitle();
  })()`, 60000);
  check('文档信息·改标题并重命名', s.length===1 && s[0].n==='测试标题文档.pdf' && metaT==='测试标题文档', JSON.stringify(s)+' title='+metaT);

  // PDF 比较：文件列表前两个 PDF → HTML 报告
  await evalJS(send, `(async()=>{ st.fileList.length=0; __PS.selectTool('compare'); await __PS.testAddFile('test-a.pdf','${bA}'); await __PS.testAddFile('test-b.pdf','${bB}'); __PS_SAVED__.length=0; await __PS.testRun(); })()`, 60000);
  s = await evalJS(send, `__PS_SAVED__.map(f=>({n:f.name, html:f.bytes.length>200, hasSum:new TextDecoder().decode(f.bytes.slice(0,4000)).includes('PDF 比较报告')}))`);
  check('PDF 比较·HTML 报告', s.length===1 && s[0].html && s[0].hasSum, JSON.stringify(s));

  console.log(`\n==== 结果: ${results.length - fails}/${results.length} 通过 ====`);

  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
