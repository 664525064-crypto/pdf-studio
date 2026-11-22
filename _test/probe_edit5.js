// 查 testRun 失败原因
(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params, timeout) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => rej(new Error('timeout ' + method)), timeout || 20000);
  });
  await send('Runtime.enable');
  const fs = require('fs');
  const bA = fs.readFileSync('test-a.pdf', 'base64');
  const ev = async (expr, t) => {
    const r = await Promise.race([
      send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }, t),
      new Promise(r => setTimeout(() => r({ timeout: true }), t))
    ]);
    if (r.timeout) return 'TIMEOUT';
    if (r.error) return 'ERR: ' + r.error.message;
    if (r.exceptionDetails) return 'EXC: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 400);
    return JSON.stringify(r.result && r.result.result && r.result.result.value);
  };
  console.log('run detail:', await ev('(async()=>{ __PS_SAVED__.length=0; __PS.selectTool("edittext"); await __PS.testOpenDoc("test-a.pdf","' + bA + '"); document.getElementById("f_ekw").value="Sample Text"; document.getElementById("f_etxt").value=""; const v={}; for(const el of document.querySelectorAll("[data-opt]")){ v[el.dataset.opt]=el.type==="checkbox"?el.checked:el.value; } let err=null; try{ await run(); }catch(e){ err=e.message; } return {saved:__PS_SAVED__.map(f=>f.name), status:document.getElementById("status").textContent, err, ekw:document.getElementById("f_ekw").value}; })()', 60000));
  process.exit(0);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
