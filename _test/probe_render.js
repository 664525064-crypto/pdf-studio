/* 渲染保存后的文件，截图对比 */
const fs = require('fs');
const CDP = process.env.CDP_PORT || 9234;

(async()=>{
  const b64 = fs.readFileSync(process.env.PROBE_FILE || 'out/policy_p1_编辑.pdf').toString('base64');
  const list = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
  const page = list.find(t=>t.type==='page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id=0; const pend=new Map();
  ws.onmessage = m=>{ const d=JSON.parse(m.data); if(d.id&&pend.has(d.id)){ pend.get(d.id)(d); pend.delete(d.id); } };
  await new Promise((res,rej)=>{ ws.onopen=res; ws.onerror=rej; });
  const send=(method,params)=>new Promise((res)=>{ const i=++id; pend.set(i,res); ws.send(JSON.stringify({id:i,method,params})); });

  const expr = `(async()=>{
    await __PS.testResetEdits();
    await __PS.testOpenDoc('render.pdf','${b64}');
    await new Promise(r=>setTimeout(r,1800));
    await __PS.openEditor(0);
    await new Promise(r=>setTimeout(r,1800));
    // 只渲染 canvas，不显示编辑覆盖层：先截原始渲染
    const shot1 = await window.__PDFSTUDIO_BRIDGE__.shot();
    // 找总保险金额与被保险人行
    const rows = ED.lines.filter(l=>/总保险金额|被保险人|投保人/.test(l.text||''))
      .map(l=>({t:(l.text||'').slice(0,40), y:+l.y.toFixed(1), x:+l.x.toFixed(1)}));
    return { shot: shot1, rows };
  })()`;

  const raw = await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
  if(raw.result && raw.result.exceptionDetails) console.log('EXC:', JSON.stringify(raw.result.exceptionDetails).slice(0,600));
  const v = raw.result && raw.result.result && raw.result.result.value;
  if(v && v.shot) fs.writeFileSync('render_saved.png', Buffer.from(v.shot.split(',').pop(), 'base64'));
  console.log('rows:', JSON.stringify(v && v.rows, null, 1));
  console.log('shot saved:', v && v.shot ? v.shot.slice(0,30) : 'none');
  ws.close(); process.exit(0);
})().catch(e=>{ console.error('FATAL', e.message); process.exit(2); });
