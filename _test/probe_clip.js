const fs=require('fs');
const PORT=process.env.CDP_PORT||9235;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  let list; for(let i=0;i<20;i++){ try{ list=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; }catch(e){ await sleep(800);} }
  const page=list.find(t=>t.type==='page');
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  let seq=0; const pending=new Map();
  ws.onmessage=ev=>{ const m=JSON.parse(ev.data); if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);} };
  const send=(method,params)=>new Promise((res,rej)=>{ const id=++seq; pending.set(id,m=>m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)); ws.send(JSON.stringify({id,method,params:params||{}})); setTimeout(()=>{ if(pending.has(id)){pending.delete(id);rej(new Error('timeout '+method));} },40000); });
  await send('Page.enable');
  const r=await send('Page.captureScreenshot',{format:'png', clip:{x:100,y:200,width:440,height:90,scale:3}, fromSurface:false});
  fs.writeFileSync('clip1.png', Buffer.from(r.data,'base64'));
  console.log('shot clip1.png');
  ws.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
