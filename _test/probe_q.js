const PORT=9234;
(async()=>{
  const list=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page=list.find(t=>t.type==='page'); const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let seq=0; const pend=new Map();
  ws.onmessage=ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
  const send=(method,params,timeout=20000)=>new Promise((res,rej)=>{const id=++seq;pend.set(id,m=>res(m));ws.send(JSON.stringify({id,method,params:params||{}}));setTimeout(()=>{if(pend.has(id)){pend.delete(id);rej(new Error('timeout'));}},timeout);});
  const r1=await send('Runtime.evaluate',{expression:'1+1',returnByValue:true});
  console.log('t1',JSON.stringify(r1));
  const expr=`(async()=>{ const e=__PS.editor.edits.filter(x=>x.multi).pop(); if(!e) return {none:true};
    return { y:e.y, yEnd:e.yEnd, nOld:e.nOld, lead:e.lead, gapUp:e.gapUp, size:e.size,
             rows:(e.text||'').split(String.fromCharCode(10)).length }; })()`;
  const r2=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
  console.log('t2',JSON.stringify(r2).slice(0,900));
  const r3=await send('Runtime.evaluate',{expression:`(async()=>{ const u8=__PS_SAVED__[__PS_SAVED__.length-1].bytes; const d=await pdfjsLib.getDocument({data:u8.slice()}).promise; const pg=await d.getPage(1); const tc=await pg.getTextContent(); return JSON.stringify({h:pg.view[3], items:tc.items.map(i=>[i.str.slice(0,10), Math.round(i.transform[4]), Math.round(i.transform[5])])}); })()`,awaitPromise:true,returnByValue:true},60000);
  console.log('t3',(r3.result&&r3.result.value||'').slice(0,1600));
  ws.close(); process.exit(0);
})();
