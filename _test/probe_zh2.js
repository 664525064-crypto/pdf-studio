/* 探针：真实保单第 1 页 —— 看「被保险人」「保险期间」两行的 size/fam 和编辑预览的计算样式 */
const fs = require('fs');
const b64 = fs.readFileSync(__dirname + '/policy_p1.pdf').toString('base64');

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
  const ev = async (x, t = 90000) => {
    const m = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true }, t);
    if (m.result.exceptionDetails) return 'EXC:' + JSON.stringify(m.result.exceptionDetails).slice(0, 400);
    return m.result.result.value;
  };

  console.log('open:', await ev(`(async()=>{ await __PS.testOpenDoc('policy_p1.pdf','${b64}'); await new Promise(r=>setTimeout(r,1500)); await __PS.openEditor(0); await new Promise(r=>setTimeout(r,2000)); return {open:ED.open, lines:ED.lines.length, scale:ED.scale, docFam:ED.docFam, pageFam:pageFamily(0)}; })()`, 180000));

  console.log('lines:', JSON.stringify(await ev(`(function(){
    return ED.lines.map(function(L,i){
      var t=(L.text||'');
      if(t.indexOf('被保险人')<0 && t.indexOf('保险期间')<0 && t.indexOf('投保人')<0 && t.indexOf('总保险金额')<0) return null;
      return {i:i, t:t.slice(0,26), size:L.size, h:L.h, x:+L.x.toFixed(1), x2:+L.x2.toFixed(1), fam:L.fam, inkH:L.inkH||null, ink:L.ink, items:L.items.length};
    }).filter(Boolean);
  })()`), null, 1));

  // 打开「被保险人」行编辑框，读预览样式
  console.log('editPreview:', JSON.stringify(await ev(`(async()=>{
    var i=ED.lines.findIndex(function(L){return (L.text||'').indexOf('被保险人')>=0});
    edStartEdit(i);
    await new Promise(r=>setTimeout(r,400));
    var d=document.querySelector('.edin');
    if(!d) return {err:'no box'};
    var cs=getComputedStyle(d);
    var r=d.getBoundingClientRect();
    var L=ED.lines[i];
    var b=edBox(L);
    return {fsize:d.dataset.fsize, fam:d.style.fontFamily, px:cs.fontSize, weight:cs.fontWeight, lh:cs.lineHeight,
            box:{x:+r.left.toFixed(1),y:+r.top.toFixed(1),w:+r.width.toFixed(1),h:+r.height.toFixed(1)},
            lineBox:{x:+b.left.toFixed(1),y:+b.top.toFixed(1),w:+b.width.toFixed(1),h:+b.height.toFixed(1)},
            text:d.innerText.slice(0,20)};
  })()`, 60000), null, 1));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
