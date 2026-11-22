/* 视觉验证（整段）：提交段落改长后截编辑器 canvas，确认无浮框、下方内容画布内让位 */
const fs = require('fs');
const CDP = process.env.CDP_PORT || 9234;

(async()=>{
  const b64 = fs.readFileSync(process.env.PROBE_FILE || 'policy_p1.pdf').toString('base64');
  const list = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
  const page = list.find(t=>t.type==='page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id=0; const pend=new Map();
  ws.onmessage = m=>{ const d=JSON.parse(m.data); if(d.id&&pend.has(d.id)){ pend.get(d.id)(d); pend.delete(d.id); } };
  await new Promise((res,rej)=>{ ws.onopen=res; ws.onerror=rej; });
  const send=(method,params)=>new Promise((res)=>{ const i=++id; pend.set(i,res); ws.send(JSON.stringify({id:i,method,params})); });

  const expr = `(async()=>{
    await __PS.testResetEdits();
    await __PS.testOpenDoc('wysiwyg_multi.pdf','${b64}');
    await new Promise(r=>setTimeout(r,1500));
    await __PS.openEditor(0);
    await new Promise(r=>setTimeout(r,1500));
    // 找一个真正的多行段落（g.length>1），且首行不是乱码（乱码行点击会走异步修复）
    let pi=-1;
    (ED.paras||[]).forEach((g,idx)=>{ if(g.length>1 && pi<0){ const L0=ED.lines[g[0]]||{};
      if((L0.text||'').length>12 && !L0.bad) pi=idx; } });
    if(pi<0) return {err:'no multi para', paras:(ED.paras||[]).map(g=>g.length)};
    const li=ED.paras[pi][0];
    const P0=edParaInfo(pi);
    const y0=P0.y0, yEnd=P0.yEnd, nOld=P0.n;
    // 直接调核心提交（Ctrl+Enter 最终也走 edApplyParaText），提交里会 edPaintLayer
    const newText=P0.text+'另外补充一段较长的说明文字，用来验证整段改长之后自动折行、下方内容自动让位的所见即所得预览效果，这一句故意写得比较长以确保行数净增加两行以上。';
    const ok=edApplyParaText(pi, newText);
    await new Promise(r=>setTimeout(r,700));
    // 覆盖层状态
    const ovs=[...document.querySelectorAll('#edLayer .edov.multi')].map(el=>{
      const cs=getComputedStyle(el);
      return { bg:cs.backgroundColor, bc:cs.borderTopStyle, color:cs.color };
    });
    // 截整页 canvas
    const cv=$('edCanvas');
    const shot=cv.toDataURL('image/png');
    return { ok, nOld, rows:ED.edits.map(e=>e.multi?{multi:1,nOld:e.nOld,y:+e.y.toFixed(1)}:null).filter(Boolean),
             ovs, shot, y0:+y0.toFixed(1) };
  })()`;

  const raw = await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true,timeout:90000});
  if(raw.result && raw.result.exceptionDetails) console.log('EXC:', JSON.stringify(raw.result.exceptionDetails).slice(0,600));
  const v = raw.result && raw.result.result && raw.result.result.value;
  if(v && v.shot) fs.writeFileSync('wysiwyg_multi.png', Buffer.from(v.shot.split(',').pop(), 'base64'));
  console.log(JSON.stringify({ok:v&&v.ok, nOld:v&&v.nOld, ovs:v&&v.ovs, recs:v&&v.recs}, null, 1));
  ws.close(); process.exit(0);
})().catch(e=>{ console.error('FATAL', e.message); process.exit(2); });
