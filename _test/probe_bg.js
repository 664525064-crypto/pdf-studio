const fs=require('fs');
const PORT=process.env.CDP_PORT||9235;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  let list; for(let i=0;i<20;i++){ try{ list=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; }catch(e){ await sleep(800);} }
  const page=list.find(t=>t.type==='page');
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  let seq=0; const pending=new Map(); const ctxs=[];
  ws.onmessage=ev=>{ const m=JSON.parse(ev.data); if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);} if(m.method==='Runtime.executionContextCreated') ctxs.push(m.params.context); };
  const send=(method,params)=>new Promise((res,rej)=>{ const id=++seq; pending.set(id,m=>m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)); ws.send(JSON.stringify({id,method,params:params||{}})); setTimeout(()=>{ if(pending.has(id)){pending.delete(id);rej(new Error('timeout '+method));} },40000); });
  await send('Runtime.enable'); await send('Page.enable'); await sleep(800);
  const ctx=ctxs.find(c=>!c.name)||ctxs[ctxs.length-1];
  const ev=async e=>{ const r=await send('Runtime.evaluate',{expression:e,contextId:ctx.id,awaitPromise:true,returnByValue:true,userGesture:true}); return r.result&&r.result.value; };
  await ev(`(()=>{const o=document.querySelector('.edov'); o.style.background='#ff0000'; return 1;})()`);
  await sleep(300);
  const r=await send('Page.captureScreenshot',{format:'png', fromSurface:false, captureBeyondViewport:false});
  fs.writeFileSync('diag_bg.png', Buffer.from(r.data,'base64'));
  await ev(`(()=>{document.querySelector('.edov').style.background=''; return 1;})()`);
  console.log('ok');
  ws.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
