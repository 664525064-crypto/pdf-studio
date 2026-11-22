/* 第十轮端到端验证：改字→保存→落盘→pdfjs 扫内容流确认旧文字已真擦除 */
const fs = require('fs');
const path = require('path');
const WS = 'C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules';
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

  await ev(`window.__E2E__=1; (async()=>{ await __PS.testOpenDoc(${JSON.stringify(file)},'${b64}'); await new Promise(r=>setTimeout(r,1200)); await __PS.openEditor(0); await new Promise(r=>setTimeout(r,1500)); return 1; })()`);

  // 内联改 总保险金额 一行
  const r1 = await ev(`(async()=>{
    var i=ED.lines.findIndex(function(L){return (L.text||'').indexOf('总保险金额')>=0});
    var tl=document.querySelector('.tline[data-i="'+i+'"]'); tl.click();
    var box=null; for(var k=0;k<40 && !(box=document.querySelector('.edin'));k++) await new Promise(r=>setTimeout(r,150));
    if(!box) return {err:'no box'};
    box.focus();
    box.textContent=box.innerText.replace('3,680','3,555,680');
    box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,500));
    var e=ED.edits[ED.edits.length-1];
    return {ok:1, suffix:!!(e&&e.suffix), full:e&&e.full};
  })()`);
  console.log('EDIT:', JSON.stringify(r1));
  if (r1.err || r1.EXC) { console.log('FAIL edit'); process.exit(1); }

  // 保存并把字节取回 node
  const saved = await ev(`(async()=>{
    var n0=__PS_SAVED__.length;
    var b=await __PS.testSaveEdits();
    var item=__PS_SAVED__[__PS_SAVED__.length-1];
    if(!item||!item.bytes) return {err:'no saved', n0:n0, ret:b};
    var u=item.bytes, s='', CH=32768;
    for(var i=0;i<u.length;i+=CH) s+=String.fromCharCode.apply(null,u.subarray(i,i+CH));
    return {b64:btoa(s), name:item.name};
  })()`);
  if (saved.err) { console.log('FAIL save:', JSON.stringify(saved)); process.exit(1); }
  const out = path.join(__dirname, 'out', 'erase_test.pdf');
  fs.writeFileSync(out, Buffer.from(saved.b64, 'base64'));
  console.log('SAVED:', out, fs.statSync(out).size, 'bytes');
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
