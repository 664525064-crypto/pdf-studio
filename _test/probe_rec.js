const PORT=9234;
async function conn(){
  const list=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page=list.find(t=>t.type==='page'); const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let seq=0; const pend=new Map(); const ctxs=[];
  ws.onmessage=ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);} if(m.method==='Runtime.executionContextCreated')ctxs.push(m.params.context);};
  const send=(method,params,timeout=20000)=>new Promise((res,rej)=>{const id=++seq;pend.set(id,m=>m.error?rej(new Error(JSON.stringify(m.error))):res(m.result));ws.send(JSON.stringify({id,method,params:params||{}}));setTimeout(()=>{if(pend.has(id)){pend.delete(id);rej(new Error('timeout '+method));}},timeout);});
  await send('Runtime.enable'); await new Promise(r=>setTimeout(r,400));
  const main=ctxs.find(c=>!c.name)||ctxs[ctxs.length-1];
  return {ws,send:(m,p,t)=>send(m,p,t)};
}
(async()=>{
  const {ws,send}=await conn();
  const r=await send('Runtime.evaluate',{expression:`(async()=>{
    const e=__PS.editor.edits.filter(x=>x.multi).pop();
    const out={ rec:e?{y:e.y,yEnd:e.yEnd,nOld:e.nOld,lead:e.lead,gapUp:e.gapUp,size:e.size,w:e.w,text:e.text.split('\n').length+' lines'}:null, saved:__PS_SAVED__.length };
    if(__PS_SAVED__.length){
      const u8=__PS_SAVED__[__PS_SAVED__.length-1].bytes;
      const d=await pdfjsLib.getDocument({data:u8.slice()}).promise; const pg=await d.getPage(1);
      const tc=await pg.getTextContent();
      out.items=tc.items.map(i=>({t:i.str.slice(0,12),x:+i.transform[4].toFixed(1),y:+i.transform[5].toFixed(1)}));
      out.pageH=pg.view[3];
    }
    return out;
  })()`,awaitPromise:true,returnByValue:true},60000);
  console.log(JSON.stringify(r.result.value,null,1));
  ws.close(); process.exit(0);
})();
