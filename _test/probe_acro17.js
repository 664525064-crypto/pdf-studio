/* 探针17：页面健康检查 */
(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  console.log('targets:', list.map(t => t.type + ':' + (t.title || '').slice(0, 30)).join(', '));
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params, timeout=30000) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async x => {
    const m = await send('Runtime.evaluate', { expression: x, awaitPromise: false, returnByValue: true, userGesture: true });
    if (m.result.exceptionDetails) return 'EXC: ' + (m.result.exceptionDetails.exception && m.result.exceptionDetails.exception.description || '');
    return m.result.result.value;
  };
  console.log('alive:', await ev('1+1'));
  console.log('typeof __PS_SAVED__:', await ev('typeof __PS_SAVED__'));
  console.log('typeof __PS:', await ev('typeof __PS'));
  console.log('ED.edits:', await ev('(typeof ED!=="undefined" && ED.edits) ? ED.edits.length : "no ED"'));
  console.log('st.bytes:', await ev('(typeof st!=="undefined") ? (st.bytes ? st.bytes.length : "no bytes") : "no st"'));
  console.log('status text:', await ev('document.getElementById("status") ? document.getElementById("status").textContent.slice(0,80) : "?"'));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
