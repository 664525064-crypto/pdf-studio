/* 等 OCR 完成后 dump 行的 ocr 标记与文本 */
const fs = require('fs');
const CDP = process.env.CDP_PORT || 9234;
const FILE = process.env.PROBE_FILE || 'policy_p1.pdf';

(async()=>{
  const b64 = fs.readFileSync(FILE).toString('base64');
  const list = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
  const page = list.find(t=>t.type==='page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id=0; const pend=new Map();
  ws.onmessage = m=>{ const d=JSON.parse(m.data); if(d.id&&pend.has(d.id)){ pend.get(d.id)(d); pend.delete(d.id); } };
  await new Promise((res,rej)=>{ ws.onopen=res; ws.onerror=rej; });
  const send=(method,params)=>new Promise((res)=>{ const i=++id; pend.set(i,res); ws.send(JSON.stringify({id:i,method,params})); });

  const expr = `(async()=>{
    await __PS.testResetEdits();
    await __PS.testOpenDoc('ocr.pdf','${b64}');
    await new Promise(r=>setTimeout(r,1500));
    await __PS.openEditor(0);
    // 等 OCR 原位重识别完成（最多 30 秒）
    for(let k=0;k<60;k++){
      if(!ED.ocrBusy) break;
      await new Promise(r=>setTimeout(r,500));
    }
    await new Promise(r=>setTimeout(r,1000));
    return { ocrBusy:ED.ocrBusy!=null?ED.ocrBusy:'done',
      lines: ED.lines.map((l,i)=>({i, t:(l.text||'').slice(0,42), ocr:!!l.ocr, y:+l.y.toFixed(1)})).filter(l=>l.ocr || /保险金额/.test(l.t)) };
  })()`;

  const raw = await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true,timeout:90000});
  if(raw.result && raw.result.exceptionDetails) console.log('EXC:', JSON.stringify(raw.result.exceptionDetails).slice(0,600));
  console.log('VAL:', JSON.stringify(raw.result && raw.result.result && raw.result.result.value, null, 1));
  ws.close(); process.exit(0);
})().catch(e=>{ console.error('FATAL', e.message); process.exit(2); });
