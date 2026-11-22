/* dump 指定行的 item 结构（x / w / 字号 / 字体），用于诊断差异重写起点 */
const fs = require('fs');
const file = process.argv[2] || 'policy_p1.pdf';
const kws = (process.argv[3] || '保险期间,总保险金额').split(',');
const b64 = fs.readFileSync(__dirname + '/' + file).toString('base64');

(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params, timeout = 120000) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async (x, t = 120000) => {
    const m = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true }, t);
    if (m.result.exceptionDetails) return 'EXC:' + JSON.stringify(m.result.exceptionDetails).slice(0, 600);
    return m.result.result.value;
  };

  console.log('boot:', JSON.stringify(await ev(`(async()=>{ await __PS.testOpenDoc(${JSON.stringify(file)},'${b64}'); await new Promise(r=>setTimeout(r,1200)); await __PS.openEditor(0); await new Promise(r=>setTimeout(r,1500)); return {n:ED.lines.length, scale:ED.scale, vpH:ED.vpH}; })()`, 180000)));

  const out = await ev(`(function(){
    var kws=${JSON.stringify(kws)};
    return kws.map(function(kw){
      var i=ED.lines.findIndex(function(L){return (L.text||'').indexOf(kw)>=0});
      if(i<0) return {kw:kw, err:'not found'};
      var L=ED.lines[i];
      return {kw:kw, i:i, text:L.text, x:L.x, x2:L.x2, y:L.y, size:L.size, ocr:!!L.ocr,
        items:(L.items||[]).map(function(it){return {s:it.str, x:it.x, w:it.w, h:it.h, f:it.font&&it.font.name}}),
        map:(function(){ var m=edCharMap(L); return m.length===String(L.text||'').length? m.map(function(c){return [+c.x.toFixed(1), c.ch]}): 'MISMATCH '+m.length+'/'+String(L.text||'').length; })(),
        diff:(function(){ var sp=edDiffSuffix(L, String(L.text||'').replace(/09日/,'55555'), edFam(L)); return sp; })()
      };
    });
  })()`);
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
