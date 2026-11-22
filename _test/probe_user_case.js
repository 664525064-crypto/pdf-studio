/* 诊断：打开用户保存的 policy_p1_编辑.pdf，dump 总保险金额行文本项 */
const fs = require('fs');
const CDP = process.env.CDP_PORT || 9234;
const FILE = process.env.PROBE_FILE || 'out/policy_p1_编辑.pdf';

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
    await __PS.testOpenDoc('check.pdf','${b64}');
    await new Promise(r=>setTimeout(r,1500));
    await __PS.openEditor(0);
    await new Promise(r=>setTimeout(r,1500));
    const lines = ED.lines.filter(l=>l.page===0 && (
      (l.text||'').indexOf('总保险金额')>=0 || (l.text||'').indexOf('144400')>=0 ||
      (l.text||'').indexOf('让人')>=0 || (l.text||'').indexOf('贴图')>=0 ||
      /¥|￥/.test(l.text||'')));
    return { n:ED.lines.length,
      hits: lines.map(l=>({ t:l.text, x:+l.x.toFixed(1), y:+l.y.toFixed(1), x2:+l.x2.toFixed(1), size:+l.size.toFixed(1), fam:l.fam, ocr:!!l.ocr })) };
  })()`;

  const raw = await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
  if(raw.result && raw.result.exceptionDetails) console.log('EXC:', JSON.stringify(raw.result.exceptionDetails).slice(0,800));
  console.log('VAL:', JSON.stringify(raw.result && raw.result.result && raw.result.result.value, null, 1));
  ws.close(); process.exit(0);
})().catch(e=>{ console.error('FATAL', e.message); process.exit(2); });
