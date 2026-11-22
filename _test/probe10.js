/* probe10: addtext 失败复现（可靠上下文模式） */
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
  await sleep(4500);
  const main = ctxs.find(c => !c.name) || ctxs[ctxs.length - 1];
  const ev = async (expr, timeout) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true, contextId: main.id }, timeout || 30000);
    if (r.exceptionDetails) throw new Error('JS异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).slice(0, 300));
    return r.result.value;
  };
  const bA = fs.readFileSync(path.join(__dirname, 'test-a.pdf')).toString('base64');
  await ev(`window.__E2E__=1; 'ok'`);
  await ev(`(async()=>{ await __PS.testOpenDoc('test-a.pdf','${bA}'); __PS.selectTool('addtext'); document.getElementById('f_txt').value='审批通过'; document.getElementById('f_stamp').checked=true; await __PS.testRun(); return 'done'; })()`, 90000);
  await sleep(500);
  console.log('status:', await ev('document.getElementById("status").textContent'));
  console.log('saved:', await ev('__PS_SAVED__.map(f=>f.name).join(",")'));
  ws.close(); setTimeout(() => process.exit(0), 200);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
