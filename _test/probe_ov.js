const PORT=process.env.CDP_PORT||9235;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  let list; for(let i=0;i<20;i++){ try{ list=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; }catch(e){ await sleep(800);} }
  const page=list.find(t=>t.type==='page');
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  let seq=0; const pending=new Map(); const ctxs=[];
  ws.onmessage=ev=>{ const m=JSON.parse(ev.data); if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);} if(m.method==='Runtime.executionContextCreated') ctxs.push(m.params.context); };
  const send=(method,params)=>new Promise((res,rej)=>{ const id=++seq; pending.set(id,m=>m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)); ws.send(JSON.stringify({id,method,params:params||{}})); setTimeout(()=>{ if(pending.has(id)){pending.delete(id);rej(new Error('timeout '+method));} },30000); });
  await send('Runtime.enable'); await sleep(1000);
  const ctx=ctxs.find(c=>!c.name)||ctxs[ctxs.length-1];
  const ev=async e=>{ const r=await send('Runtime.evaluate',{expression:e,contextId:ctx.id,awaitPromise:true,returnByValue:true,userGesture:true}); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception||r.exceptionDetails.text).slice(0,300)); return r.result.value; };
  const out=await ev(`(()=>{
    const ov=[...document.querySelectorAll('.edov')].map(d=>{const r=d.getBoundingClientRect(); const cs=getComputedStyle(d); return {txt:d.textContent, left:+r.left.toFixed(1), w:+r.width.toFixed(1), bg:cs.backgroundColor, ov:cs.overflow, h:+r.height.toFixed(1)};});
    const tl=[...document.querySelectorAll('.tline')].map(d=>{const r=d.getBoundingClientRect(); return {t:d.title, left:+r.left.toFixed(1), w:+r.width.toFixed(1)};});
    const e=__PS.editor.edits.map(x=>({x:+x.x.toFixed(2), w:+x.w.toFixed(2), text:x.text, size:+x.size.toFixed(2), h:+x.h.toFixed(2)}));
    return {ov, tl, e, scale:+__PS.editor.scale.toFixed(3)};
  })()`);
  console.log(JSON.stringify(out,null,1));
  ws.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
