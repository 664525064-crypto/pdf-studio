/* 截图3：行内编辑 + 格式条 */
const fs = require('fs');
const path = require('path');
(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params, timeout=12000) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async x => {
    const m = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true });
    if (m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails.exception && m.result.exceptionDetails.exception.description || m.result.exceptionDetails).slice(0, 300));
    return m.result.result.value;
  };
  const shot = async name => {
    for (let i = 0; i < 10; i++) {
      try {
        const m = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85, fromSurface: i % 2 === 0 }, 8000);
        if (m && m.result && m.result.data) { fs.writeFileSync(path.join(__dirname, name), Buffer.from(m.result.data, 'base64')); console.log('saved', name); return true; }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 1200));
    }
    console.log('FAILED', name); return false;
  };

  // 打开一行文字编辑（用测试同款路径）
  const r = await ev(`(async()=>{
    if(ED.edits.length){ ED.edits.length=0; edPaintOverlays(); edSyncSide(); }
    if(!ED.open) await __PS.openEditor(0);
    document.getElementById('edFind').value='';
    document.getElementById('edRepl').value='';
    const i=ED.lines.findIndex(l=>l.items && l.items.map(x=>String(x.str||'')).join('').trim().length>=6);
    if(i<0) return 'no line';
    edStartEdit(i);
    await new Promise(r2=>setTimeout(r2,600));
    const f=document.getElementById('edFmt');
    return {fmt: f? getComputedStyle(f).display : 'none', inline: !!ED.inline};
  })()`);
  console.log('state:', JSON.stringify(r));
  await new Promise(r2 => setTimeout(r2, 700));
  await shot('shot3_editfmt.png');
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
