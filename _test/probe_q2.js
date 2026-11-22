const PORT=9234;
(async()=>{
  const list=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page=list.find(t=>t.type==='page'); const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let seq=0; const pend=new Map();
  ws.onmessage=ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
  const send=(method,params,timeout=90000)=>new Promise((res,rej)=>{const id=++seq;pend.set(id,res);ws.send(JSON.stringify({id,method,params:params||{}}));setTimeout(()=>{if(pend.has(id)){pend.delete(id);rej(new Error('timeout'));}},timeout);});
  const ev=async(expr)=>{ const m=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true}); if(m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0,300)); return m.result.result.value; };
  const r=await ev(`(async()=>{
    const out={};
    const e=__PS.editor.edits.filter(x=>x.multi).pop();
    out.rec=e?{y:e.y,yEnd:e.yEnd,nOld:e.nOld,lead:e.lead,gapUp:e.gapUp,size:e.size,w:e.w,text:e.text}:null;
    const u8=__PS_SAVED__[__PS_SAVED__.length-1].bytes;
    const d=await pdfjsLib.getDocument({data:u8.slice()}).promise; const pg=await d.getPage(1); const tc=await pg.getTextContent();
    out.h=pg.view[3];
    out.items=tc.items.map(i=>[i.str.slice(0,14), Math.round(i.transform[4]), Math.round(i.transform[5])]);
    return JSON.stringify(out);
  })()`);
  console.log(r);
  ws.close(); process.exit(0);
})();
