/* 单点探针：复现 testOpenDoc */
const fs = require('fs');
(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let seq = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (m, p, t = 30000) => new Promise(res => {
    const id = ++seq; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); res({ result: { type: 'timeout' } }); } }, t);
  });
  await send('Runtime.enable');
  const ev = async e => {
    const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true, userGesture: true }, 60000);
    return (r.result && r.result.value !== undefined) ? r.result.value : JSON.stringify(r).slice(0, 400);
  };
  const b = fs.readFileSync(__dirname + '/test-a.pdf').toString('base64');
  console.log('open:', await ev('__PS.testOpenDoc("t.pdf","' + b + '").then(()=>"ok").catch(e=>"ERR:"+(e&&e.message||e))'));
  await new Promise(r => setTimeout(r, 1500));
  console.log('status:', await ev('document.getElementById("status").textContent'));
  console.log('pages:', await ev('document.querySelectorAll(".pcell").length'));
  ws.close(); setTimeout(() => process.exit(0), 200);
})();
