/* 视觉验证：复现用户操作（单行改 + 查找替换）后整页截图，确认一行一个框、字不再拆开 */
const fs = require('fs');
const b64 = fs.readFileSync(__dirname + '/policy_p1.pdf').toString('base64');

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
    if (m.result.exceptionDetails) return 'EXC:' + JSON.stringify(m.result.exceptionDetails).slice(0, 400);
    return m.result.result.value;
  };

  await ev(`(async()=>{ await __PS.testOpenDoc('policy_p1.pdf','${b64}'); await new Promise(r=>setTimeout(r,1200)); await __PS.openEditor(0); await new Promise(r=>setTimeout(r,1500)); return 1; })()`, 180000);

  // 用户路径：①保险期间单行改一次 ②总保险金额单行改（叁伯→叁佰、拥→捌）③再对两行做查找替换
  console.log(await ev(`(async()=>{
    async function edit(kw, fn){
      var i=ED.lines.findIndex(function(L){return (L.text||'').indexOf(kw)>=0});
      var tl=document.querySelector('.tline[data-i="'+i+'"]'); if(!tl) return 'no tl '+kw;
      tl.click();
      var box=null; for(var k=0;k<40 && !(box=document.querySelector('.edin'));k++) await new Promise(r=>setTimeout(r,120));
      if(!box) return 'no box';
      box.focus(); box.textContent=fn(ED.lines[i].text);
      box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
      await new Promise(r=>setTimeout(r,250)); return 'ok';
    }
    var a=await edit('保险期间', function(t){return t.replace('自2026','2026')});
    var b=await edit('总保险金额', function(t){return t.replace('叁伯','叁佰').replace('拥','捌').replace('壹伯','壹佰')});
    document.getElementById('edFind').value='二十四时止'; document.getElementById('edRepl').value='二十四时';
    await edBatchReplace(); await new Promise(r=>setTimeout(r,500));
    document.getElementById('edFind').value='元整'; document.getElementById('edRepl').value='元正';
    await edBatchReplace(); await new Promise(r=>setTimeout(r,500));
    var ls=document.getElementById('edList');
    return JSON.stringify({a,b, nRec:ED.edits.length,
      recs:ED.edits.map(function(e){return {y:+e.y.toFixed(1), full:(e.full||'').slice(0,40), t:(e.text||'').slice(0,30)}}),
      boxes:[...document.querySelectorAll('#edLayer .edov')].map(function(n){return {y:+parseFloat(n.style.top).toFixed(0), w:+parseFloat(n.style.width).toFixed(0), t:(n.textContent||'').slice(0,24)}})});
  })()`, 120000));

  // 截图（走主进程 capturePage，窗口被挡也能出图）
  const data = await ev(`(async()=>{ await new Promise(r=>setTimeout(r,600)); const d=await window.__PDFSTUDIO_BRIDGE__.shot(); return d; })()`, 60000);
  if (typeof data === 'string' && data.length > 1000) {
    fs.writeFileSync(__dirname + '/fix_split_after.png', Buffer.from(data.replace(/^data:image\/png;base64,/, ''), 'base64'));
    console.log('shot ok');
  } else console.log('shot fail', String(data).slice(0, 120));
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
