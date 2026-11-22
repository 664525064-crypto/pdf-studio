// 探针：诊断扫描件转 HTML
const path = require('path');
const PORT = process.env.CDP_PORT || 9234;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); const ctxs = [];
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.executionContextCreated') ctxs.push(m.params.context); };
  const send = (method, params, timeout = 15000) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  await send('Runtime.enable');
  await new Promise(r => setTimeout(r, 500));
  const mainCtx = (ctxs.find(c => !c.name) || ctxs[ctxs.length - 1]);
  const evalJS = async (expr, timeout) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true, contextId: mainCtx.id }, timeout || 30000);
    if (r.exceptionDetails) throw new Error('JS异常: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0, 600));
    return r.result.value;
  };

  const info = await evalJS(`({
    tool: __PS && __PS.state ? __PS.state.tool : window.st ? st.tool : null,
    hasFimg: !!document.getElementById('f_himg'),
    optsHtml: (document.getElementById('opts')||{innerHTML:''}).innerHTML.slice(0,200),
    toolCount: (typeof TOOLS!=='undefined') ? TOOLS.find(t=>t.id==='p2html').opts.length : -1,
    selSize: typeof st!=='undefined' ? st.sel.size : -1,
    name: typeof st!=='undefined' ? st.name : null
  })`);
  console.log(JSON.stringify(info, null, 2));
  process.exit(0);
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
