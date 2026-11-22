/* 视觉验证：提交金额行修改后，截编辑器 canvas（所见即所得） */
const fs = require('fs');
const CDP = process.env.CDP_PORT || 9234;
const NEWNUM = process.env.NEWNUM || '(¥3,6让人80, 144400.00贴图元)';

(async()=>{
  const b64 = fs.readFileSync(process.env.PROBE_FILE || 'policy_p1.pdf').toString('base64');
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
    await __PS.testOpenDoc('wysiwyg.pdf','${b64}');
    await new Promise(r=>setTimeout(r,1500));
    await __PS.openEditor(0);
    await new Promise(r=>setTimeout(r,1500));
    const i=ED.lines.findIndex(l=>(l.text||'').indexOf('总保险金额')===0);
    const L=ED.lines[i];
    const oldNum=/\\(¥[^）]*）/.exec(L.text);
    const newText=L.text.replace(oldNum[0], '${esc(NEWNUM)}');
    document.querySelector('.tline[data-i="'+i+'"]').click();
    let box=null; for(let k=0;k<40 && !(box=document.querySelector('.edin'));k++) await new Promise(r=>setTimeout(r,200));
    if(!box) return {err:'no box'};
    box.focus(); box.textContent=newText;
    box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,500));
    // 截 canvas 金额行区域
    const cv=$('edCanvas');
    const k=cv.width/ED.vpW;
    const yTop=cv.height-492*k, yBot=cv.height-455*k;
    const x0=30*k, x1=430*k;
    const cv2=document.createElement('canvas'); cv2.width=Math.round(x1-x0); cv2.height=Math.round(yBot-yTop);
    cv2.getContext('2d').drawImage(cv, Math.round(x0),Math.round(yTop), Math.round(x1-x0),Math.round(yBot-yTop), 0,0, cv2.width, cv2.height);
    const shot=cv2.toDataURL('image/png');
    // 覆盖层应透明
    const ov=document.querySelector('#edLayer .edov.cvp');
    const ovBg=ov?ov.style.background:'none';
    return { shot, ovBg, recs:ED.edits.length };
  })()`;

  const raw = await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true,timeout:90000});
  if(raw.result && raw.result.exceptionDetails) console.log('EXC:', JSON.stringify(raw.result.exceptionDetails).slice(0,600));
  const v = raw.result && raw.result.result && raw.result.result.value;
  if(v && v.shot) fs.writeFileSync('wysiwyg_preview.png', Buffer.from(v.shot.split(',').pop(), 'base64'));
  console.log('ovBg:', v && v.ovBg, 'recs:', v && v.recs);
  ws.close(); process.exit(0);
})().catch(e=>{ console.error('FATAL', e.message); process.exit(2); });
