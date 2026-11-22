/* 第二轮编辑：先改一次并保存，再打开保存后的文件继续改，看是否出现「新字浮在原字上、原字没被盖住」 */
const fs = require('fs');
const path = require('path');
const file = process.argv[2] || 'policy_p1.pdf';
const b64 = fs.readFileSync(__dirname + '/' + file).toString('base64');
const OUT = 'C:/Users/Administrator/WorkBuddy/2026-11-16-19-18-26/pdf-studio/_test/out';

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
    if (m.result.exceptionDetails) return 'EXC:' + JSON.stringify(m.result.exceptionDetails).slice(0, 800);
    return m.result.result.value;
  };
  const edit = (kw, fn) => ev(`(async()=>{
    var i=ED.lines.findIndex(function(L){return (L.text||'').indexOf(${JSON.stringify(kw)})>=0});
    if(i<0) return {err:'no line'};
    var tl=document.querySelector('.tline[data-i="'+i+'"]'); if(!tl) return {err:'no tl'};
    tl.click();
    var box=null; for(var k=0;k<40 && !(box=document.querySelector('.edin'));k++) await new Promise(r=>setTimeout(r,150));
    if(!box) return {err:'no box'};
    box.focus();
    var oldT=ED.lines[i].text, newT=(${fn})(oldT);
    box.textContent=newT;
    box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,400));
    var e=ED.edits[ED.edits.length-1];
    return {i:i, oldT:oldT, newT:newT, rec:e?{suffix:!!e.suffix,x:+e.x.toFixed(1),w:+e.w.toFixed(1),y:+e.y.toFixed(1),text:e.text,full:e.full,hscale:e.hscale}:null,
      ovs:[].slice.call(document.querySelectorAll('#edLayer .edov')).map(function(n){return {l:n.style.left,t:n.style.top,w:n.style.width,h:n.style.height,bg:getComputedStyle(n).backgroundColor,tx:(n.textContent||'').slice(0,18)}})};
  })()`);

  console.log('boot1:', await ev(`(async()=>{ await __PS.testOpenDoc(${JSON.stringify(file)},'${b64}'); await new Promise(r=>setTimeout(r,1200)); await __PS.openEditor(0); await new Promise(r=>setTimeout(r,1500)); return ED.lines.length; })()`));
  console.log('EDIT1:', JSON.stringify(await edit('保险期间', `function(t){return t.replace('09日','55555')}`)));
  const filesBefore = new Set(fs.readdirSync(OUT));
  console.log('SAVE1:', JSON.stringify(await ev(`__PS.testSaveEdits()`)));
  const saved = fs.readdirSync(OUT).filter(f => !filesBefore.has(f) && /\.pdf$/i.test(f));
  console.log('saved files:', saved);

  const f2 = saved[0];
  if (!f2) { console.log('no saved file'); process.exit(0); }
  const b642 = fs.readFileSync(path.join(OUT, f2)).toString('base64');

  console.log('boot2:', await ev(`(async()=>{ await __PS.testOpenDoc(${JSON.stringify(f2)},'${b642}'); await new Promise(r=>setTimeout(r,1400)); await __PS.openEditor(0); await new Promise(r=>setTimeout(r,1600)); return ED.lines.length; })()`));

  console.log('LINES2:', JSON.stringify(await ev(`ED.lines.filter(function(L){return /保险期间|总保险金额/.test(L.text||'')}).map(function(L,i){return {text:L.text,x:+L.x.toFixed(1),x2:+L.x2.toFixed(1),y:+L.y.toFixed(1),items:(L.items||[]).map(function(it){return [it.str,+it.x.toFixed(1),+it.w.toFixed(1)]})}})`), null, 1));

  console.log('EDIT2:', JSON.stringify(await edit('保险期间', `function(t){return t.replace('55555','88888')}`), null, 1));

  const data = await ev(`(async()=>{ await new Promise(r=>setTimeout(r,400)); return await window.__PDFSTUDIO_BRIDGE__.shot(); })()`, 60000);
  if (typeof data === 'string' && data.length > 1000) {
    fs.writeFileSync(__dirname + '/round2_preview.png', Buffer.from(data.replace(/^data:image\/png;base64,/, ''), 'base64'));
    console.log('shot ok');
  } else console.log('shot fail', String(data).slice(0, 100));

  const fb = new Set(fs.readdirSync(OUT));
  console.log('SAVE2:', JSON.stringify(await ev(`__PS.testSaveEdits()`)));
  console.log('saved2:', fs.readdirSync(OUT).filter(f => !fb.has(f) && /\.pdf$/i.test(f)));
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
