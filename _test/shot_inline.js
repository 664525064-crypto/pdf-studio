/* 截图：原位编辑状态（点行后不弹浮条，直接在原位改） */
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

  const b64 = fs.readFileSync(path.join(__dirname, 'test-a.pdf')).toString('base64');
  await evalJS(`(async()=>{ await __PS.testOpenDoc('test-a.pdf','${b64}'); __PS.selectTool('edittext'); await __PS.openEditor(0); })()`, 120000);
  await sleep(1200);
  const info = await evalJS(`(async()=>{
    const i=__PS.editor.lines.findIndex(L=>/Sample/.test(L.text));
    const tl=document.querySelector('.tline[data-i="'+i+'"]');
    tl.click();
    await new Promise(r=>setTimeout(r,150));
    const box=document.querySelector('.edin');
    if(box){ box.focus(); box.textContent='这里直接被改成了新文字'; }
    const b=box?box.getBoundingClientRect():null;
    return { i, hasBox:!!box, float: getComputedStyle(document.getElementById('edFloat')).display,
             boxRect: b?{x:b.x,y:b.y,w:b.width,h:b.height}:null };
  })()`, 60000);
  await sleep(300);
  await raw('Page.bringToFront', {}, 20000).catch(() => {});
  await sleep(600);
  let shot = null;
  for (let k = 0; k < 3 && !shot; k++) {
    try { shot = await raw('Page.captureScreenshot', { format: 'png', fromSurface: false, captureBeyondViewport: false }, 40000); }
    catch (e) { console.log('retry shot', k, e.message); await sleep(800); }
  }
  if (!shot) throw new Error('截图三次都超时');
  const out = path.join(__dirname, 'inline-edit.png');
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('SHOT', out, JSON.stringify(info));
  ws.close();
  setTimeout(() => process.exit(0), 200);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
