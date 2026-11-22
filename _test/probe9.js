/* probe9: 测试 app:// 下能否创建真实 Worker */
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
  const ev = async (expr, timeout) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true, contextId: main.id }, timeout || 30000);
    if (r.exceptionDetails) throw new Error('JS异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).slice(0, 250));
    return r.result.value;
  };
  console.log('Worker ctor:', await ev(`(async()=>{ try { const w = new Worker('vendor/pdf.worker.min.js'); return await new Promise(r=>{ const t=setTimeout(()=>{w.terminate(); r('created-but-no-msg');},6000); w.onmessage=(e)=>{clearTimeout(t); w.terminate(); r('msg:'+JSON.stringify(e.data).slice(0,80));}; w.onerror=(e)=>{clearTimeout(t); w.terminate(); r('err:'+e.message);}; }); } catch(e){ return 'CTOR-FAIL:'+e.message; } })()`, 20000));
  ws.close(); setTimeout(() => process.exit(0), 200);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
