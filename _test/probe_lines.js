/* dump 一页的行结构（含同 y 分段情况） */
const fs = require('fs');
const file = process.argv[2] || 'policy_edited_p1.pdf';
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

  console.log('boot:', await ev(`(async()=>{ await __PS.testOpenDoc(${JSON.stringify(file)},'${b64}'); await new Promise(r=>setTimeout(r,1200)); await __PS.openEditor(0); await new Promise(r=>setTimeout(r,1500)); return ED.lines.length; })()`, 180000));

  const rows = await ev(`ED.lines.map((L,i)=>({i,text:L.text,x:+L.x.toFixed(1),x2:+L.x2.toFixed(1),y:+L.y.toFixed(1),size:L.size,n:(L.items||[]).length}))`);
  // 按 y 分组，标出同一条视觉行被拆成几段
  const byY = {};
  for (const r of rows) { const k = r.y; (byY[k] = byY[k] || []).push(r); }
  for (const k of Object.keys(byY).sort((a, b) => b - a)) {
    const g = byY[k];
    const flag = g.length > 1 ? '  <<< 同 y ' + g.length + ' 段' : '';
    for (const r of g) console.log(`y=${r.y} i=${r.i} x=${r.x}..${r.x2} n=${r.n} sz=${r.size}${flag} | ${JSON.stringify(r.text.slice(0, 60))}`);
  }

  // 再模拟：点同一视觉行的两个片段各改一次，看产生几条记录
  const t = await ev(`(async()=>{
    var ys=ED.lines.map(function(L){return L.y});
    var y0=ys.filter(function(v){return v>480 && v<510})[0];
    var idxs=ED.lines.map(function(L,i){return i}).filter(function(i){return Math.abs(ED.lines[i].y-y0)<1.2});
    var out=[];
    for (const i of idxs.slice(0,2)){
      var tl=document.querySelector('.tline[data-i="'+i+'"]'); if(!tl){out.push({i,err:'no tl'}); continue;}
      tl.click();
      var box=null; for(var k=0;k<40 && !(box=document.querySelector('.edin'));k++) await new Promise(r=>setTimeout(r,150));
      if(!box){out.push({i,err:'no box'}); continue;}
      box.focus(); box.textContent=ED.lines[i].text+'Z';
      box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      await new Promise(r=>setTimeout(r,250));
    }
    return {y0, idxs, recs:ED.edits.map(function(e){return {suffix:!!e.suffix,x:+e.x.toFixed(1),w:+e.w.toFixed(1),y:+e.y.toFixed(1),t:(e.text||'').slice(0,20)}}),
            boxes:[...document.querySelectorAll('#edLayer .edov')].map(function(n){return {x:+parseFloat(n.style.left).toFixed(1),w:+parseFloat(n.style.width).toFixed(1),t:(n.textContent||'').slice(0,20)}})};
  })()`, 90000);
  console.log('EDIT2:', JSON.stringify(t, null, 1));
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
