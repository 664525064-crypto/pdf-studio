/* 手动探针：检查 __E2E__ / 状态栏 / 手动跑 openDoc */
const fs = require('fs');
const path = require('path');
const PORT = 9234;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); const ctxs = [];
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
  await new Promise(r => setTimeout(r, 600));
  const mainCtx = ctxs.find(c => !c.name) || ctxs[ctxs.length - 1];
  const ev = async (expr, timeout) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true, contextId: mainCtx.id }, timeout || 30000);
    if (r.exceptionDetails) throw new Error('JS异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).slice(0, 300));
    return r.result.value;
  };
  console.log('ctx:', mainCtx.id, JSON.stringify(ctxs.map(c => c.name || '(main)')));
  console.log('E2E:', await ev('window.__E2E__'));
  console.log('status:', await ev('document.getElementById("status").textContent'));
  console.log('busy:', await ev('__PS.state.busy'));
  const bA = fs.readFileSync(path.join(__dirname, 'test-a.pdf')).toString('base64');
  console.log('openDoc:', await ev(`__PS.testOpenDoc('t.pdf','${bA}').then(()=> 'ok').catch(e=>'ERR:'+e.message)`, 45000));
  await sleep(1500);
  console.log('after status:', await ev('document.getElementById("status").textContent'));
  ws.close(); setTimeout(() => process.exit(0), 200);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
