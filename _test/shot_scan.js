/* 截图：扫描件（无文字层）在编辑器里自动 OCR → 点字原位改 → 保存 */
const fs = require('fs');
const path = require('path');
const PORT = 9234;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const LINES = [
  ['中国人民财产保险股份有限公司起重机械财产损失保险附加吊臂断裂保险（2026 版）条款', 20, 'center'],
  ['投保附加险的条件', 18, 'center'],
  ['第一条 本条款为保险单载明的起重机械类主险（以下简称主险）的附加险条款，', 15, 'left'],
  ['只有在投保主险的基础上，方可投保本附加险。', 15, 'left'],
  ['附加险内容', 18, 'center'],
  ['第二条 在保险期间内，被保险人使用保险单中载明的起重机械设备时，在吊装货物', 15, 'left'],
  ['过程中，因起重机械设备吊臂自身发生断裂造成吊臂的损失，保险人依照本附加险', 15, 'left'],
  ['合同的约定负责赔偿。', 15, 'left'],
  ['第三条 由于下列原因情况造成的保险标的的损失和费用，保险人不负责赔偿：', 15, 'left'],
  ['（一）与外界物体碰撞；', 15, 'left'],
  ['（二）超载吊装；', 15, 'left'],
  ['（三）违反相关的操作规程。', 15, 'left'],
  ['第四条 在发生保险事故时，赔偿金额不超过保险标的的实际价值，同时不超过保险', 15, 'left'],
  ['标的的保险金额。', 15, 'left']
];

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

  // 1) 造一张「扫描件」：Canvas 画中文保单页 → PNG → 整页嵌入 PDF（无文字层）
  await evalJS(`window.__E2E__=1`, 20000);
  const b64 = await evalJS(`(async()=>{
    const W=1240,H=1754, cv=document.createElement('canvas'); cv.width=W; cv.height=H;
    const c=cv.getContext('2d'); c.fillStyle='#fdfdfb'; c.fillRect(0,0,W,H);
    c.fillStyle='#1a1a1a'; c.textBaseline='top';
    const LINES=${JSON.stringify(LINES)};
    let y=110;
    for(const [text,size,align] of LINES){
      c.font=size+'px "SimSun","宋体",serif';
      if(align==='center'){ c.textAlign='center'; c.fillText(text, W/2, y); }
      else { c.textAlign='left'; c.fillText(text, 96, y); }
      y += Math.round(size*2.05);
    }
    const blob=await new Promise(r=>cv.toBlob(r,'image/png'));
    const png=new Uint8Array(await blob.arrayBuffer());
    const doc=await PDFLib.PDFDocument.create(); const pg=doc.addPage([595.28,841.89]);
    const img=await doc.embedPng(png); pg.drawImage(img,{x:0,y:0,width:595.28,height:841.89});
    const b=await doc.save(); let s=''; for(let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]);
    return btoa(s);
  })()`, 180000);

  await evalJS(`(async()=>{ await __PS.testOpenDoc('scan-cn.pdf','${b64}'); __PS.selectTool('edittext'); await __PS.openEditor(0); })()`, 120000);

  // 2) 等自动 OCR 出可点的行
  const ready = await evalJS(`(async()=>{
    const t0=Date.now();
    while(Date.now()-t0<180000){ if(__PS.editor.lines.length) break; await new Promise(r=>setTimeout(r,500)); }
    return { lines:__PS.editor.lines.length, first:(__PS.editor.lines[0]||{}).text, hint:document.getElementById('edHint').textContent };
  })()`, 240000);

  // 3) 点第三条那行，就地改成「第三条（已改）…」
  const info = await evalJS(`(async()=>{
    const ls=__PS.editor.lines;
    let i=ls.findIndex(L=>/第三条/.test(L.text));
    if(i<0) i=Math.min(ls.length-1, 8);
    const tl=document.querySelector('.tline[data-i="'+i+'"]');
    tl.click();
    await new Promise(r=>setTimeout(r,200));
    const box=document.querySelector('.edin');
    if(box){ box.focus(); box.textContent='第三条 由于下列原因造成的损失和费用，保险人负责赔偿：'; }
    const b=box?box.getBoundingClientRect():null;
    return { i, old:ls[i].text, hasBox:!!box, float:getComputedStyle(document.getElementById('edFloat')).display,
             boxRect:b?{x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)}:null };
  })()`, 60000);
  await sleep(400);
  await raw('Page.bringToFront', {}, 20000).catch(() => {});
  await sleep(700);
  let shot = null;
  for (let k = 0; k < 4 && !shot; k++) {
    const opts = k === 0 ? { format: 'png', fromSurface: true, captureBeyondViewport: false }
                         : { format: 'png', fromSurface: false, captureBeyondViewport: false };
    try { shot = await raw('Page.captureScreenshot', opts, 40000); }
    catch (e) { console.log('retry shot', k, e.message); await sleep(800); }
  }
  if (!shot) throw new Error('截图三次都超时');
  const out1 = path.join(__dirname, 'scan-edit.png');
  fs.writeFileSync(out1, Buffer.from(shot.data, 'base64'));

  // 4) 回车提交 → 保存 → 重开保存结果截图（看覆盖效果）
  const saved = await evalJS(`(async()=>{
    const box=document.querySelector('.edin');
    box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,200));
    __PS_SAVED__.length=0;
    const s=await __PS.testSaveEdits();
    const f=__PS_SAVED__[0]; let b=''; for(let i=0;i<f.bytes.length;i++) b+=String.fromCharCode(f.bytes[i]);
    return { name:f.name, len:s.len, edits:s.edits, b64:btoa(b) };
  })()`, 180000);
  await evalJS(`(async()=>{ await __PS.testOpenDoc(${JSON.stringify(saved.name)},'${saved.b64}'); __PS.selectTool('edittext'); await __PS.openEditor(0); })()`, 120000);
  await sleep(1500);
  await raw('Page.bringToFront', {}, 20000).catch(() => {});
  await sleep(600);
  let shot2 = null;
  for (let k = 0; k < 4 && !shot2; k++) {
    const opts = k === 0 ? { format: 'png', fromSurface: true, captureBeyondViewport: false }
                         : { format: 'png', fromSurface: false, captureBeyondViewport: false };
    try { shot2 = await raw('Page.captureScreenshot', opts, 40000); }
    catch (e) { console.log('retry shot2', k, e.message); await sleep(800); }
  }
  if (shot2) fs.writeFileSync(path.join(__dirname, 'scan-edited.png'), Buffer.from(shot2.data, 'base64'));

  console.log('READY', JSON.stringify(ready));
  console.log('EDIT', JSON.stringify(info));
  console.log('SAVED', JSON.stringify({ name: saved.name, len: saved.len, edits: saved.edits }));
  console.log('SHOTS', out1, shot2 ? path.join(__dirname, 'scan-edited.png') : '(second failed)');
  ws.close();
  setTimeout(() => process.exit(0), 200);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
