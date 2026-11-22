/* 二次编辑复现：在已保存的文件上再改金额行 */
const fs = require('fs');
const CDP = process.env.CDP_PORT || 9234;
const FILE = process.env.PROBE_FILE || 'out/repro_编辑.pdf';
const NEWTEXT = process.env.NEWTEXT || '';

(async()=>{
  const b64 = fs.readFileSync(FILE).toString('base64');
  const list = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
  const page = list.find(t=>t.type==='page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id=0; const pend=new Map();
  ws.onmessage = m=>{ const d=JSON.parse(m.data); if(d.id&&pend.has(d.id)){ pend.get(d.id)(d); pend.delete(d.id); } };
  await new Promise((res,rej)=>{ ws.onopen=res; ws.onerror=rej; });
  const send=(method,params)=>new Promise((res)=>{ const i=++id; pend.set(i,res); ws.send(JSON.stringify({id:i,method,params})); });
  const esc = s=>s.replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n');

  const expr = `(async()=>{
    await __PS.testResetEdits();
    await __PS.testOpenDoc('repro2.pdf','${b64}');
    await new Promise(r=>setTimeout(r,1500));
    await __PS.openEditor(0);
    await new Promise(r=>setTimeout(r,1500));
    const i=ED.lines.findIndex(l=>(l.text||'').indexOf('总保险金额')===0);
    const L=ED.lines[i];
    if(!L) return {err:'no line', texts:ED.lines.map(l=>(l.text||'').slice(0,20))};
    let newText;
    ${NEWTEXT ? `newText='${esc(NEWTEXT)}';` : `newText=L.text.replace('144400.00','999999.99');`}
    document.querySelector('.tline[data-i="'+i+'"]').click();
    let box=null; for(let k=0;k<40 && !(box=document.querySelector('.edin'));k++) await new Promise(r=>setTimeout(r,200));
    if(!box) return {err:'no box'};
    box.focus(); box.textContent=newText;
    box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,400));
    const recs=ED.edits.filter(e=>e.page===0 && Math.abs(e.y-L.y)<1.5).map(e=>({
      suffix:!!e.suffix, x:+(e.x||0).toFixed(1), w:+(e.w||0).toFixed(1), y:+e.y.toFixed(1), text:(e.text||'').slice(0,36) }));
    const sv=await __PS.testSaveEdits();
    return { Ltext:L.text.slice(0,50), newText:newText.slice(0,50), recs, svLen:sv.len };
  })()`;

  const raw = await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true,timeout:60000});
  if(raw.result && raw.result.exceptionDetails) console.log('EXC:', JSON.stringify(raw.result.exceptionDetails).slice(0,600));
  console.log('VAL:', JSON.stringify(raw.result && raw.result.result && raw.result.result.value, null, 1));
  ws.close(); process.exit(0);
})().catch(e=>{ console.error('FATAL', e.message); process.exit(2); });
