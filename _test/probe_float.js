/* 复现「新字浮在原字上、原有文字没盖住」：按用户截图的操作在指定行插入文字，dump 覆盖块几何 */
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
  const send = (method, params, timeout = 120000) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async (x, t = 120000) => {
    const m = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true }, t);
    if (m.result.exceptionDetails) return 'EXC:' + JSON.stringify(m.result.exceptionDetails).slice(0, 800);
    return m.result.result.value;
  };

  console.log('boot:', await ev(`(async()=>{ await __PS.testOpenDoc(${JSON.stringify(file)},'${b64}'); await new Promise(r=>setTimeout(r,1200)); await __PS.openEditor(0); await new Promise(r=>setTimeout(r,1500)); return ED.lines.length; })()`, 180000));

  const out = await ev(`(async()=>{
    var i=ED.lines.findIndex(function(L){return (L.text||'').indexOf('保险期间')>=0});
    var tl=document.querySelector('.tline[data-i="'+i+'"]');
    tl.click();
    var box=null; for(var k=0;k<40 && !(box=document.querySelector('.edin'));k++) await new Promise(r=>setTimeout(r,150));
    if(!box) return {err:'no box'};
    box.focus();
    var newT='保险期间：自2026年09月10日零时起，至2027年09月55555二十四时止';
    box.textContent=newT;
    box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,400));
    var e=ED.edits[ED.edits.length-1];
    var ovs=[].slice.call(document.querySelectorAll('#edLayer .edov')).map(function(n){
      var r=n.getBoundingClientRect();
      return {cls:n.className, left:n.style.left, top:n.style.top, w:n.style.width, h:n.style.height,
              bg:getComputedStyle(n).backgroundColor, fs:n.style.fontSize, text:(n.textContent||'').slice(0,20),
              rect:[+r.left.toFixed(1),+r.top.toFixed(1),+r.width.toFixed(1),+r.height.toFixed(1)]};
    });
    return {line:{x:ED.lines[i].x,x2:ED.lines[i].x2,y:ED.lines[i].y,size:ED.lines[i].size},
            rec:e?{suffix:!!e.suffix,x:e.x,w:e.w,y:e.y,h:e.h,size:e.size,text:e.text,full:e.full,hscale:e.hscale}:null,
            styles:{scale:ED.scale}, ovs:ovs,
            layerRect:(function(){var r=document.getElementById('edLayer').getBoundingClientRect();return [r.left,r.top,r.width,r.height]})()};
  })()`, 120000);
  console.log(JSON.stringify(out, null, 1));

  const data = await ev(`(async()=>{ await new Promise(r=>setTimeout(r,400)); return await window.__PDFSTUDIO_BRIDGE__.shot(); })()`, 60000);
  if (typeof data === 'string' && data.length > 1000) {
    fs.writeFileSync(__dirname + '/float_before.png', Buffer.from(data.replace(/^data:image\/png;base64,/, ''), 'base64'));
    console.log('shot ok');
  } else console.log('shot fail', String(data).slice(0, 120));
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
