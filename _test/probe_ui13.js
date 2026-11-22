/* 诊断：插入图片后，点行是否还能打开 .edin */
(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params, timeout = 30000) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async x => {
    const m = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true });
    if (m.result.exceptionDetails) return 'EXC:' + JSON.stringify(m.result.exceptionDetails).slice(0, 300);
    return m.result.result.value;
  };
  console.log('lines:', JSON.stringify(await ev('ED.lines.map(l=>({t:(l.text||"").slice(0,14),y:Math.round(l.y)}))')));
  console.log('tlines:', await ev(`document.querySelectorAll('.tline').length`));
  const r = await ev(`(async()=>{
    const i=__PS.editor.lines.findIndex(l=>l.text.indexOf('签单日期')>=0);
    const el=document.querySelector('.tline[data-i="'+i+'"]');
    if(!el) return {i, err:'no tline'};
    el.click();
    await new Promise(r=>setTimeout(r,300));
    const box=document.querySelector('.edin');
    return {i, hasEl:true, inlineBox:!!box, edInline:!!ED.inline, fmtTarget:!!(window.fmtTarget)};
  })()`);
  console.log('click:', JSON.stringify(r));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
