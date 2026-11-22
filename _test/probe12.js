/* probe12: 打印 CDP 错误 + 上下文列表 + 渲染/字体状态 */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const PORT = process.argv[2] || 9236;
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); const ctxs = []; const errors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.executionContextCreated') ctxs.push(m.params.context);
  };
  const send = (method, params, timeout = 20000) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => m.error ? res({ __error: JSON.stringify(m.error) }) : res(m));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); res({ __to: 1 }); } }, timeout);
  });
  await send('Runtime.enable');
  await sleep(800);
  console.log('ctxs:', JSON.stringify(ctxs.map(c => c.id + ':' + (c.name || '(main)'))));
  const main = ctxs.find(c => !c.name) || ctxs[0];
  const ev = async (expr, timeout) => {
    const r = await send('Runtime.evaluate', { expression: expr, contextId: main.id, returnByValue: true, awaitPromise: true }, timeout || 20000);
    if (r.__to) return 'TIMEOUT';
    if (r.__error) return 'CDP-ERROR: ' + r.__error;
    const res_ = r.result;
    if (res_ && res_.exceptionDetails) return 'EXC: ' + ((res_.exceptionDetails.exception && res_.exceptionDetails.exception.description) || res_.exceptionDetails.text).slice(0, 150);
    return JSON.stringify(res_ && res_.result && res_.result.value);
  };
  console.log('1+1:', await ev('1+1'));
  console.log('fonts:', await ev('[...document.fonts].map(f=>f.family+":"+f.status).join("|") || "empty"'));
  console.log('cells:', await ev('document.querySelectorAll(".pcell").length'));
  console.log('status:', await ev('document.getElementById("status").textContent'));
  console.log('render p1 (10s race):', await ev('(async()=>{ const page=await __PS.state.jsDoc.getPage(1); const vp=page.getViewport({scale:0.2}); const cv=document.createElement("canvas"); cv.width=vp.width; cv.height=vp.height; return await Promise.race([page.render({canvasContext:cv.getContext("2d"), viewport:vp}).promise.then(()=>"done"), new Promise(r=>setTimeout(()=>r("TIMEOUT10s"),10000))]); })()'));
  console.log('render p2 (10s race):', await ev('(async()=>{ const page=await __PS.state.jsDoc.getPage(2); const vp=page.getViewport({scale:0.2}); const cv=document.createElement("canvas"); cv.width=vp.width; cv.height=vp.height; return await Promise.race([page.render({canvasContext:cv.getContext("2d"), viewport:vp}).promise.then(()=>"done"), new Promise(r=>setTimeout(()=>r("TIMEOUT10s"),10000))]); })()'));
  console.log('fonts after:', await ev('[...document.fonts].map(f=>f.family+":"+f.status).join("|") || "empty"'));
  ws.close(); setTimeout(() => process.exit(0), 300);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
