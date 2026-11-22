/* probe5: reload → getDocument → merge → getDocument → testOpenDoc 分步定位 */
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
  await send('Runtime.enable'); await send('Page.enable');
  ctxs = [];
  await send('Page.reload');
  await sleep(5000);
  const mainCtx = ctxs.find(c => !c.name) || ctxs[ctxs.length - 1];
  const ev = async (expr, timeout) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true, contextId: mainCtx.id }, timeout || 30000);
    if (r.exceptionDetails) throw new Error('JS异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).slice(0, 250));
    return r.result.value;
  };
  console.log('ctx:', mainCtx.id);
  const bA = fs.readFileSync(path.join(__dirname, 'test-a.pdf')).toString('base64');
  const bB = fs.readFileSync(path.join(__dirname, 'test-b.pdf')).toString('base64');
  const bEnc = fs.readFileSync(path.join(__dirname, 'test-enc.pdf')).toString('base64');
  const bPng = fs.readFileSync(path.join(__dirname, 'test.png')).toString('base64');

  await ev(`window.__E2E__=1; 'ok'`);
  console.log('S1 getDocument:', await ev(`(async()=>{ const bytes=Uint8Array.from(atob('${bA}'),c=>c.charCodeAt(0)); const js=await pdfjsLib.getDocument({data:bytes, cMapUrl:'vendor/cmaps/', cMapPacked:true, standardFontDataUrl:'vendor/standard_fonts/'}).promise; return 'ok:'+js.numPages; })()`, 45000));

  console.log('S2 merge:', await ev(`(async()=>{ __PS.selectTool('merge'); await __PS.testAddFile('a.pdf','${bA}'); await __PS.testAddFile('b.pdf','${bB}'); await __PS.testRun(); return 'ok:'+__PS_SAVED__.length; })()`, 60000));
  await new Promise(r => setTimeout(r, 1000));

  console.log('S3 getDocument after merge:', await ev(`(async()=>{ const bytes=Uint8Array.from(atob('${bA}'),c=>c.charCodeAt(0)); const js=await pdfjsLib.getDocument({data:bytes, cMapUrl:'vendor/cmaps/', cMapPacked:true, standardFontDataUrl:'vendor/standard_fonts/'}).promise; return 'ok:'+js.numPages; })()`, 45000));

  console.log('S4 testOpenDoc:', await ev(`__PS.testOpenDoc('t.pdf','${bA}').then(()=> 'ok').catch(e=>'ERR:'+e.message)`, 45000));
  await sleep(2000);
  console.log('S5 status:', await ev('document.getElementById("status").textContent'));
  console.log('S6 pages:', await ev('document.querySelectorAll(".pcell").length'));
  ws.close(); setTimeout(() => process.exit(0), 200);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
