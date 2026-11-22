const PORT=9234;
(async()=>{
  const list=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page=list.find(t=>t.type==='page'); const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let seq=0; const pend=new Map();
  ws.onmessage=ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
  const send=(m,p,t=30000)=>new Promise((res,rej)=>{const id=++seq;pend.set(id,res);ws.send(JSON.stringify({id,method:m,params:p||{}}));setTimeout(()=>{if(pend.has(id)){pend.delete(id);rej(new Error('timeout'));}},t);});
  const ev=async e=>{const m=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true}); if(m.result.exceptionDetails) return 'ERR '+JSON.stringify(m.result.exceptionDetails).slice(0,400); return m.result.result.value;};
  console.log(await ev(`(()=>{
    const L={text:'ABCDEFGHIJKLMN',x:56,x2:224,size:12};
    const fam=edFam(L);
    const css=famCss(fam);
    const mw=measureCss(L.text,css,12);
    return JSON.stringify({fam,css,mw,w:L.x2-L.x,sz:L.size,r:(L.x2-L.x)/mw,
      pageFam:pageFamily(ED.page), docFam:ED.docFam, famMode:ED.famMode,
      fontSet:(()=>{_mctx.font='12px '+css; return _mctx.font;})()});
  })()`));
  ws.close(); process.exit(0);
})();
