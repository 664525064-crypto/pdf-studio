/* 可靠探针：锁定主世界上下文 + 打印异常 */
const fs = require('fs');
async function makeClient(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pend = new Map(); const ctxs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.executionContextCreated') ctxs.push(m.params.context);
  };
  const send = (m, p, t = 30000) => new Promise(res => {
    const id = ++seq; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); res({ error: 'timeout' }); } }, t);
  });
  await send('Runtime.enable');
  await new Promise(r => setTimeout(r, 400));
  let main = ctxs.find(c => c.name === '' || !c.name) || ctxs[ctxs.length - 1];
  const ev = async (expr, timeout) => {
    const r = await send('Runtime.evaluate', { expression: expr, contextId: main.id, awaitPromise: true, returnByValue: true, userGesture: true }, timeout || 60000);
    if (r.error) return 'TIMEOUT';
    if (r.result && r.result.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails.text);
    return r.result && r.result.result ? r.result.result.value : JSON.stringify(r).slice(0, 300);
  };
  return { ws, send, ev, main };
}
if (require.main === module) {
  (async () => {
    const { ws, ev } = await makeClient(9234);
    console.log('pdfjsWorker:', await ev('typeof window.pdfjsWorker'));
    console.log('workerSrc:', await ev('JSON.stringify(window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions)'));
    console.log('scripts:', await ev('[...document.querySelectorAll("script[src]")].map(s=>s.src).join(" | ")'));
    console.log('jsErrors:', await ev('window.__jsErr || "none"'));
    ws.close(); setTimeout(() => process.exit(0), 200);
  })().catch(e => { console.error('FATAL', e.message); process.exit(1); });
}
module.exports = { makeClient };
