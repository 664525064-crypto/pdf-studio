const PORT=9234;
(async()=>{
  const list=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page=list.find(t=>t.type==='page'); const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  let seq=0; const pend=new Map();
  ws.onmessage=ev=>{const m=JSON.parse(ev.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
  const send=(m,p,t=30000)=>new Promise((res,rej)=>{const id=++seq;pend.set(id,res);ws.send(JSON.stringify({id,method:m,params:p||{}}));setTimeout(()=>{if(pend.has(id)){pend.delete(id);rej(new Error('timeout'));}},t);});
  const ev=async e=>{const m=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true}); if(m.result.exceptionDetails) return 'ERR '+JSON.stringify(m.result.exceptionDetails).slice(0,300); return m.result.result.value;};
  console.log('types', await ev(`JSON.stringify({tlb:typeof textLooksBad, mb:typeof edMarkBadLines, mcs:typeof measureCss})`));
  console.log('mcs', await ev(`JSON.stringify({w:measureCss('ABCDEFGHIJKLMN','"SimSun",serif',12), w2:measureCss('司法管辖：中国境内','"SimSun",serif',12)})`));
  console.log('tlb1', await ev(`String(textLooksBad({text:'ABCDEFGHIJKLMN',x:56,x2:224,size:12}))`));
  console.log('tlb2', await ev(`String(textLooksBad({text:'司法管辖：中国境内（不含港澳台）',x:56,x2:224,size:12}))`));
  console.log('line', await ev(`JSON.stringify(__PS.editor.lines.slice(0,2).map(l=>({t:l.text,x:l.x,x2:l.x2,size:l.size,bad:l.bad,ocr:l.ocr})))`));
  ws.close(); process.exit(0);
})();
