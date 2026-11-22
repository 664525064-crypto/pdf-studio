/* 探针：直接构造一条「同文本」修改记录，量预览层文字宽度 vs 原文字形宽度，并截图 */
const fs = require('fs');
const b64 = fs.readFileSync(__dirname + '/policy_p1.pdf').toString('base64');

(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params, timeout = 90000) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async (x, t = 90000) => {
    const m = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true }, t);
    if (m.result.exceptionDetails) return 'EXC:' + JSON.stringify(m.result.exceptionDetails).slice(0, 400);
    return m.result.result.value;
  };

  console.log('open:', await ev(`(async()=>{ await __PS.testOpenDoc('policy_p1.pdf','${b64}'); await new Promise(r=>setTimeout(r,1500)); await __PS.openEditor(0); await new Promise(r=>setTimeout(r,2000)); return {lines:ED.lines.length, scale:+ED.scale.toFixed(4), docFam:ED.docFam}; })()`, 180000));

  console.log('measure:', JSON.stringify(await ev(`(function(){
    var i=ED.lines.findIndex(function(L){return (L.text||'').indexOf('被保险人：')===0});
    var L=ED.lines[i]; var s=ED.scale;
    ED.edits=[{page:0,x:L.x,y:L.y,w:L.x2-L.x,h:L.size,old:L.text,text:L.text,color:'#000000',size:L.size,
               ocr:false,bg:null,fam:'song',autoFam:false,autoSize:true,bold:false,italic:false}];
    edPaintLayer();
    var ov=document.querySelector('.edov');
    var sp=ov && ov.querySelector('span');
    var rr=null; if(sp){ var rg=document.createRange(); rg.selectNodeContents(sp); rr=rg.getBoundingClientRect(); }
    return {i:i, scale:+s.toFixed(4), size:L.size, fam:L.fam,
            origPtW:+(L.x2-L.x).toFixed(2), origPxW:+((L.x2-L.x)*s).toFixed(1),
            ovFontPx:ov?getComputedStyle(ov).fontSize:null, ovWeight:ov?getComputedStyle(ov).fontWeight:null,
            ovFam:ov?getComputedStyle(ov).fontFamily:null,
            textPxW:rr?+rr.width.toFixed(1):null, textPxH:rr?+rr.height.toFixed(1):null,
            measured:+(measureCss(L.text, famCss('song'), L.size)*s).toFixed(1)};
  })()`, 60000), null, 1));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
