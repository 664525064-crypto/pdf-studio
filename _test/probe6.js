/* probe6: 主世界内分步打点，定位 openDoc 卡点 */
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); let ctxs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.executionContextCreated') ctxs.push(m.params.context);
  };
  const send = (method, params, timeout = 15000) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  await send('Runtime.enable');
  await new Promise(r => setTimeout(r, 800));
  const main = ctxs.filter(c => !c.name).pop() || ctxs[ctxs.length - 1];
  console.log('ctx candidates:', JSON.stringify(ctxs.map(c => c.id + ':' + (c.name || '(main)'))), '=> use', main.id);
  const ev = async (expr, timeout) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true, contextId: main.id }, timeout || 30000);
    if (r.exceptionDetails) throw new Error('JS异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).slice(0, 250));
    return r.result.value;
  };
  const bA = fs.readFileSync(path.join(__dirname, 'test-a.pdf')).toString('base64');
  const r1 = await ev(`(async()=>{
    const steps=[];
    try{
      const bytes=Uint8Array.from(atob('${bA}'),c=>c.charCodeAt(0));
      steps.push('start');
      const js=await pdfjsLib.getDocument({data:bytes.slice()}).promise; steps.push('doc:'+js.numPages);
      const page=await js.getPage(1); steps.push('page');
      const vp0=page.getViewport({scale:1}); steps.push('vp:'+Math.round(vp0.width));
      const cv=document.createElement('canvas'); const vp=page.getViewport({scale:0.2});
      cv.width=Math.round(vp.width); cv.height=Math.round(vp.height); steps.push('cv');
      const rr=await Promise.race([page.render({canvasContext:cv.getContext('2d'), viewport:vp}).promise.then(()=>'done'), new Promise(r=>setTimeout(()=>r('RENDER_TIMEOUT'),8000))]);
      steps.push('render:'+rr);
      return steps.join('|');
    }catch(e){ return 'ERR:'+e.message+' @'+steps.join('|'); }
  })()`, 40000);
  console.log('R1 steps:', r1);
  const r2 = await ev(`__PS.testOpenDoc('t.pdf','${bA}').then(()=>'ok').catch(e=>'ERR:'+e.message)`, 45000).catch(e => 'HANG: ' + e.message);
  console.log('R2 openDoc:', r2);
  if (r2 === 'ok') {
    await sleep(2000);
    console.log('R3 pages:', await ev('document.querySelectorAll(".pcell").length'));
    console.log('R4 status:', await ev('document.getElementById("status").textContent'));
  }
  ws.close(); setTimeout(() => process.exit(0), 200);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
