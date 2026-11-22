/* 截图：文字版（有文字层）中文 PDF 改字 → 对比改前改后的字体/字号是否一致 */
const fs = require('fs');
const path = require('path');
const PORT = 9234;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); const ctxs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.executionContextCreated') ctxs.push(m.params.context);
  };
  const raw = (method, params, timeout = 30000) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, m => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  await raw('Runtime.enable'); await raw('Page.enable');
  await sleep(800);
  const ctx = ctxs.find(c => !c.name) || ctxs[ctxs.length - 1];
  const send = (method, params, t) => raw(method, Object.assign({ contextId: ctx.id }, params || {}), t);
  const evalJS = async (expr, timeout) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }, timeout || 60000);
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0, 300));
    return r.result.value;
  };

  await evalJS(`window.__E2E__=1`, 20000);

  // A) 造一份「文字版」中文 PDF：宋体 13pt，三行正文
  const b64 = await evalJS(`(async()=>{
    const doc=await PDFLib.PDFDocument.create(); doc.registerFontkit(fontkit);
    const r=await window.__PDFSTUDIO_BRIDGE__.font('song');
    const f=await doc.embedFont(r.bytes,{subset:true});
    const pg=doc.addPage([595.28,841.89]);
    const rows=[['第一条 本保险合同的保险标的为起重机械及其附属设备。',13],
                ['第二条 保险期间自二零二六年九月十日起至二零二七年九月九日止。',13],
                ['第三条 投保人应当在合同成立时一次性支付全部保险费。',13]];
    let y=700;
    for(const [t,sz] of rows){ pg.drawText(t,{x:60,y,size:sz,font:f}); y-=28; }
    const b=await doc.save(); let s=''; for(let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]);
    return btoa(s);
  })()`, 120000);

  await evalJS(`(async()=>{ await __PS.testOpenDoc('text-cn.pdf','${b64}'); __PS.selectTool('edittext'); await __PS.openEditor(0); })()`, 120000);
  await sleep(800);

  const scan0 = await evalJS(`(async()=>{
    await new Promise(r=>setTimeout(r,600));
    const i=__PS.editor.lines.findIndex(L=>/第二条/.test(L.text));
    return { lines:__PS.editor.lines.length, i, docFam:__PS.editor.docFam,
             fams:__PS.editor.lines.map(L=>L.fam), sample:(__PS.editor.lines[i]||{}).text };
  })()`, 60000);

  await raw('Page.bringToFront', {}, 20000).catch(() => {});
  await sleep(500);
  let shot0 = null;
  for (let k = 0; k < 4 && !shot0; k++) {
    const opts = k === 0 ? { format: 'png', fromSurface: true, captureBeyondViewport: false }
                         : { format: 'png', fromSurface: false, captureBeyondViewport: false };
    try { shot0 = await raw('Page.captureScreenshot', opts, 40000); } catch (e) { await sleep(700); }
  }
  if (shot0) fs.writeFileSync(path.join(__dirname, 'text-before.png'), Buffer.from(shot0.data, 'base64'));

  // B) 点第二行原位改成等长文字
  const edit = await evalJS(`(async()=>{
    const i=__PS.editor.lines.findIndex(L=>/第二条/.test(L.text));
    const tl=document.querySelector('.tline[data-i="'+i+'"]'); tl.click();
    await new Promise(r=>setTimeout(r,150));
    const box=document.querySelector('.edin');
    const before={ size:box.style.fontSize, family:box.style.fontFamily };
    box.focus(); box.textContent='第二条 保险期间自二零二七年一月一日起至二零二八年一月一日止。';
    box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,200));
    const e=__PS.editor.edits[0];
    return { boxBefore:before, rec:{fam:e.fam,size:e.size,h:e.h,text:e.text} };
  })()`, 60000);

  const saved = await evalJS(`(async()=>{
    __PS_SAVED__.length=0;
    const s=await __PS.testSaveEdits();
    const f=__PS_SAVED__[0]; let b=''; for(let i=0;i<f.bytes.length;i++) b+=String.fromCharCode(f.bytes[i]);
    let t=''; for(let i=0;i<Math.min(f.bytes.length,400000);i++) t+=String.fromCharCode(f.bytes[i]);
    return { name:f.name, len:s.len, simsun:/SimSun/.test(t), b64:btoa(b) };
  })()`, 180000);

  await evalJS(`(async()=>{ await __PS.testOpenDoc(${JSON.stringify(saved.name)},'${saved.b64}'); __PS.selectTool('edittext'); await __PS.openEditor(0); })()`, 120000);
  await sleep(1200);
  await raw('Page.bringToFront', {}, 20000).catch(() => {});
  await sleep(500);
  let shot1 = null;
  for (let k = 0; k < 4 && !shot1; k++) {
    const opts = k === 0 ? { format: 'png', fromSurface: true, captureBeyondViewport: false }
                         : { format: 'png', fromSurface: false, captureBeyondViewport: false };
    try { shot1 = await raw('Page.captureScreenshot', opts, 40000); } catch (e) { await sleep(700); }
  }
  if (shot1) fs.writeFileSync(path.join(__dirname, 'text-after.png'), Buffer.from(shot1.data, 'base64'));

  console.log('BEFORE', JSON.stringify(scan0));
  console.log('EDIT', JSON.stringify(edit));
  console.log('SAVED', JSON.stringify({ name: saved.name, len: saved.len, simsun: saved.simsun }));
  ws.close();
  setTimeout(() => process.exit(0), 200);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
