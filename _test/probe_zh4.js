/* 端到端复现：原页 PNG vs 保存后 PNG，同一行逐像素对比（字号/字重/字距） */
const fs = require('fs');
const path = require('path');
const OUT = 'C:/Users/Administrator/WorkBuddy/2026-11-16-19-18-26/pdf-studio/_test/out';
const origB64 = fs.readFileSync(__dirname + '/policy_p1.pdf').toString('base64');

function saveDataUrl(url, file) {
  const b = Buffer.from(url.split(',')[1], 'base64');
  fs.writeFileSync(file, b);
  return b.length;
}

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

  // 1) 打开原始页，渲染 2x
  console.log('open:', await ev(`(async()=>{ await __PS.testOpenDoc('policy_p1.pdf','${origB64}'); await new Promise(r=>setTimeout(r,1500)); await __PS.openEditor(0); await new Promise(r=>setTimeout(r,2000)); return ED.lines.length; })()`, 180000));
  const pngA = await ev(`(async()=>{ document.getElementById('edCanvas').toDataURL('image/png'); return document.getElementById('edCanvas').toDataURL('image/png'); })()`, 60000);
  console.log('orig png bytes:', pngA && pngA.startsWith ? saveDataUrl(pngA, path.join(__dirname, 'orig_p1.png')) : pngA);

  // 2) 造一条「整行重写」记录：内容与原文完全一致，字号/字体跟原文一致
  console.log('rec:', JSON.stringify(await ev(`(function(){
    var i=ED.lines.findIndex(function(L){return (L.text||'').indexOf('被保险人：')===0});
    var L=ED.lines[i];
    ED.edits=[{page:0,x:L.x,y:L.y,w:L.x2-L.x,h:L.size,old:L.text,text:L.text,color:L.ink||'#000000',
               size:L.size,ocr:false,bg:null,fam:'song',autoFam:false,autoSize:true,bold:false,italic:false}];
    edPaintLayer(); return {i:i,size:L.size,x:L.x,y:L.y,text:L.text};
  })()`)));

  // 3) 保存
  console.log('save:', JSON.stringify(await ev(`__PS.testSaveEdits()`, 180000)));
  const files = fs.readdirSync(OUT).map(f => ({ f, t: fs.statSync(path.join(OUT, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  console.log('newest out:', files.slice(0, 3).map(x => x.f));
  const saved = files[0] && files[0].f;
  if (!saved) { console.log('no saved file'); process.exit(1); }
  const savedB64 = fs.readFileSync(path.join(OUT, saved)).toString('base64');

  // 4) 打开保存结果，渲染 2x
  console.log('open saved:', await ev(`(async()=>{ await __PS.testOpenDoc('${saved}','${savedB64}'); await new Promise(r=>setTimeout(r,1500)); await __PS.openEditor(0); await new Promise(r=>setTimeout(r,1500)); return ED.lines.length; })()`, 180000));
  const pngB = await ev(`(async()=>{ return document.getElementById('edCanvas').toDataURL('image/png'); })()`, 60000);
  console.log('saved png bytes:', pngB && pngB.startsWith ? saveDataUrl(pngB, path.join(__dirname, 'saved_p1.png')) : pngB);
  console.log('SAVED_FILE=' + saved);
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
