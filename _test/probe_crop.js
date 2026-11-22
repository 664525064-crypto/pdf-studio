/* 截 edCanvas 指定区域（PDF y 462~572，x 20~420） */
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
    await new Promise(r=>setTimeout(r,1500));
    await __PS.openEditor(0);
    await new Promise(r=>setTimeout(r,1500));
    const cv=$('edCanvas');
    const W=cv.width, H=cv.height;         // dpr 已含
    const sc=cv.width/ED.vpW;              // canvas px / pdf pt（含 dpr）
    const yTop=H-572*sc, yBot=H-462*sc;
    const x0=20*sc, x1=420*sc;
    const cv2=document.createElement('canvas'); cv2.width=Math.round(x1-x0); cv2.height=Math.round(yBot-yTop);
    cv2.getContext('2d').drawImage(cv, Math.round(x0),Math.round(yTop), Math.round(x1-x0),Math.round(yBot-yTop), 0,0, cv2.width, cv2.height);
    return { shot: cv2.toDataURL('image/png'), W, H, sc:+sc.toFixed(3) };
  })()`;

  const raw = await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true,timeout:60000});
  if(raw.result && raw.result.exceptionDetails) console.log('EXC:', JSON.stringify(raw.result.exceptionDetails).slice(0,600));
  const v = raw.result && raw.result.result && raw.result.result.value;
  if(v && v.shot){
    fs.writeFileSync(process.env.OUT_PNG || 'crop_saved.png', Buffer.from(v.shot.split(',').pop(), 'base64'));
    console.log('saved', process.env.OUT_PNG || 'crop_saved.png', v.W+'x'+v.H, 'sc='+v.sc);
  } else console.log('no shot');
  ws.close(); process.exit(0);
})().catch(e=>{ console.error('FATAL', e.message); process.exit(2); });
