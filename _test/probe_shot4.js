const fs=require('fs'),path=require('path');
const PORT=9234;
(async()=>{
  const list=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page=list.find(t=>t.type==='page');
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let seq=0; const pend=new Map();
  ws.onmessage=ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
  const send=(method,params,timeout=25000)=>new Promise((res,rej)=>{const id=++seq;pend.set(id,res);ws.send(JSON.stringify({id,method,params:params||{}}));setTimeout(()=>{if(pend.has(id)){pend.delete(id);rej(new Error('timeout '+method));}},timeout);});
  try{
    const w=await send('Browser.getWindowForTarget',{targetId:page.id});
    console.log('win',JSON.stringify(w).slice(0,300));
    await send('Browser.setWindowBounds',{windowId:w.result.result.windowId,bounds:{windowState:'normal'}});
    await send('Browser.setWindowBounds',{windowId:w.result.result.windowId,bounds:{left:60,top:40,width:1440,height:950,windowState:'normal'}});
  }catch(e){ console.log('winops fail',e.message); }
  await new Promise(r=>setTimeout(r,900));
  try{
    const r=await send('Page.captureScreenshot',{format:'png',fromSurface:true},20000);
    fs.writeFileSync(path.join(__dirname,'probe-shot.png'),Buffer.from(r.result.data,'base64'));
    console.log('shot ok');
  }catch(e){ console.log('fail',e.message); }
  ws.close(); process.exit(0);
})();
