const PORT=9234;
(async()=>{
 const list=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
 const page=list.find(t=>t.type==='page');
 const ws=new WebSocket(page.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
 let seq=0; const pend=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
 const send=(method,params,to=90000)=>new Promise((res,rej)=>{const id=++seq;pend.set(id,res);ws.send(JSON.stringify({id,method,params:params||{}}));setTimeout(()=>{if(pend.has(id)){pend.delete(id);rej(new Error('timeout '+method));}},to)});
 const ev=async expr=>{const m=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true}); if(m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0,600)); return m.result.result.value;};
 console.log(await ev(`(()=>{
   const E=__PS.editor, cv=document.getElementById('edCanvas');
   const dpr=window.devicePixelRatio||1, sc=E.scale;
   const L=E.lines[4];
   const base=Math.max(L.size||0,L.h||0,6);
   const y0=Math.floor((E.vpH-(L.y+base*1.02))*sc*dpr);
   const y1=Math.ceil((E.vpH-(L.y-base*0.56))*sc*dpr);
   const x0=Math.floor((L.x-1)*sc*dpr), x1=Math.ceil((L.x2+1)*sc*dpr);
   const ctx=cv.getContext('2d',{willReadFrequently:true});
   const d=ctx.getImageData(0,0,cv.width,cv.height).data,W=cv.width;
   const lum=i=>0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
   const prof=[];
   for(let y=y0;y<=y1;y++){let m=255; for(let x=x0;x<=x1;x++){const l=lum((y*W+x)*4); if(l<m)m=l;} prof.push(Math.round(m));}
   return JSON.stringify({dpr,sc,base,y:+L.y.toFixed(1),h:+L.h.toFixed(1),win:[y0,y1],x:[x0,x1],prof});
 })()`));
 ws.close(); process.exit(0);
})().catch(e=>{console.log('EX',e.message);process.exit(1)});
