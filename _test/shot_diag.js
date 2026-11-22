/* 截图时序诊断 */
(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params, timeout=20000) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async x => {
    const m = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true });
    if (m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails.exception && m.result.exceptionDetails.exception.description || m.result.exceptionDetails).slice(0, 300));
    return m.result.result.value;
  };
  const tryShot = async label => {
    try { const m = await send('Page.captureScreenshot', { format: 'png', fromSurface: true }, 12000); console.log(label, 'OK', m.data ? m.data.length : JSON.stringify(m).slice(0,100)); return true; }
    catch (e) { console.log(label, 'FAIL', e.message); return false; }
  };
  await send('Page.enable');
  await send('Page.reload');
  await new Promise(r => setTimeout(r, 4000));
  await tryShot('home');
  const bA = require('fs').readFileSync('test-a.pdf').toString('base64');
  await ev(`(async()=>{ await __PS.testOpenDoc('test-a.pdf','${bA}'); await __PS.openEditor(0); })()`);
  await new Promise(r => setTimeout(r, 2000));
  await tryShot('editor-open-2s');
  await new Promise(r => setTimeout(r, 8000));
  await tryShot('editor-open-10s');
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
