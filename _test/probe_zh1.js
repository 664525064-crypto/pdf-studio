/* 探针：已知 12/10.5/9/14pt 的宋体行，看编辑器算出的 L.size 偏差多少 */
const fs = require('fs');
const b64 = fs.readFileSync(__dirname + '/zh-size.pdf').toString('base64');

(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params, timeout = 60000) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async (x, t = 60000) => {
    const m = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true }, t);
    if (m.result.exceptionDetails) return 'EXC:' + JSON.stringify(m.result.exceptionDetails).slice(0, 300);
    return m.result.result.value;
  };

  console.log('open:', await ev(`(async()=>{ await __PS.testOpenDoc('zh-size.pdf','${b64}'); await new Promise(r=>setTimeout(r,1200)); await __PS.openEditor(0); await new Promise(r=>setTimeout(r,1500)); return {open:ED.open, lines:ED.lines.length}; })()`, 120000));

  console.log('lines:', JSON.stringify(await ev(`(function(){
    return ED.lines.slice(0,6).map(function(L){
      return {t:(L.text||'').slice(0,12), size:L.size, h:L.h, x:Math.round(L.x), x2:Math.round(L.x2), fam:L.fam, inkH:L.inkH||null};
    });
  })()`), null, 1));

  console.log('pageFam:', await ev(`pageFamily(0)`), 'docFam:', await ev(`(function(){try{return st.docFam}catch(e){return 'err'}})()`));
  console.log('items raw:', JSON.stringify(await ev(`(async()=>{
    const p=await st.jsDoc.getPage(1); const tc=await p.getTextContent();
    return tc.items.slice(0,6).map(function(it){ return {s:(it.str||'').slice(0,10), h:+it.height.toFixed(2), w:+it.width.toFixed(1), tr:it.transform.map(function(v){return +v.toFixed(2)})}; });
  })()`, 60000), null, 1));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
