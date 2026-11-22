/* 复现用户组合操作：先查找替换修正错误字，再在同一行内联插入数字 */
const fs = require('fs');
const file = process.argv[2] || 'policy_p1.pdf';
const b64 = fs.readFileSync(__dirname + '/' + file).toString('base64');

(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const tab = list.find(t => t.type === 'page');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params, timeout = 180000) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async (x, t = 180000) => {
    const m = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true }, t);
    if (m.result.exceptionDetails) return 'EXC:' + JSON.stringify(m.result.exceptionDetails).slice(0, 900);
    return m.result.result.value;
  };

  await ev(`(async()=>{ await __PS.testOpenDoc(${JSON.stringify(file)},'${b64}'); await new Promise(r=>setTimeout(r,1200)); await __PS.openEditor(0); await new Promise(r=>setTimeout(r,1500)); return 1; })()`);

  console.log('BATCH:', JSON.stringify(await ev(`(async()=>{
    async function rep(a,b){ document.getElementById('edFind').value=a; document.getElementById('edRepl').value=b; await edBatchReplace(); await new Promise(r=>setTimeout(r,300)); }
    await rep('叁伯','叁佰'); await rep('拥万','捌万'); await rep('壹伯','壹佰');
    return ED.edits.map(function(e){return {x:+e.x.toFixed(1),w:+e.w.toFixed(1),suffix:!!e.suffix,text:(e.text||'').slice(0,20),full:(e.full||'').slice(0,34),hscale:e.hscale}});
  })()`)));

  console.log('EDIT:', JSON.stringify(await ev(`(async()=>{
    var i=ED.lines.findIndex(function(L){return (L.text||'').indexOf('总保险金额')>=0});
    var tl=document.querySelector('.tline[data-i="'+i+'"]'); tl.click();
    var box=null; for(var k=0;k<40 && !(box=document.querySelector('.edin'));k++) await new Promise(r=>setTimeout(r,150));
    if(!box) return {err:'no box'};
    box.focus();
    box.textContent=box.innerText.replace('3,680','3,555,680');
    box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,500));
    var e=ED.edits[ED.edits.length-1];
    return {line:ED.lines[i].text,
            rec:e?{suffix:!!e.suffix,x:+e.x.toFixed(1),w:+e.w.toFixed(1),y:+e.y.toFixed(1),text:e.text,full:e.full,hscale:e.hscale}:null};
  })()`)));

  console.log('OVS:', JSON.stringify(await ev(`[].slice.call(document.querySelectorAll('#edLayer .edov')).map(function(n){return {l:n.style.left,t:n.style.top,w:n.style.width,h:n.style.height,tx:(n.textContent||'').slice(0,26)}})`)));

  const data = await ev(`(async()=>{ await new Promise(r=>setTimeout(r,400)); return await window.__PDFSTUDIO_BRIDGE__.shot(); })()`, 60000);
  if (typeof data === 'string' && data.length > 1000) {
    fs.writeFileSync(__dirname + '/float_repro.png', Buffer.from(data.replace(/^data:image\/png;base64,/, ''), 'base64'));
    console.log('shot ok');
  } else console.log('shot fail', String(data).slice(0, 100));
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
