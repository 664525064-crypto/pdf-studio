const PORT=9234;
(async()=>{
 const list=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
 const page=list.find(t=>t.type==='page');
 const ws=new WebSocket(page.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
 let seq=0; const pend=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
 const send=(method,params,to=90000)=>new Promise((res,rej)=>{const id=++seq;pend.set(id,res);ws.send(JSON.stringify({id,method,params:params||{}}));setTimeout(()=>{if(pend.has(id)){pend.delete(id);rej(new Error('timeout '+method));}},to)});
 const ev=async expr=>{const m=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true}); if(m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0,700)); return m.result.result.value;};
 console.log(JSON.stringify(await ev(`(()=>{
   const E=__PS.editor, Ls=E.lines.filter(l=>l.text&&l.text.trim());
   const maxW=Math.max(...Ls.map(l=>l.x2-l.x));
   return {dbg:E.unifyDbg, maxW:+maxW.toFixed(1), paras:(E.paras||[]).map(g=>g.length),
     rows:Ls.map(l=>{const t=l.text.replace(/\s+/g,''); const w=measureCss(t,famCss(edFam(l)),100);
       return {t:t.slice(0,8), w:+(l.x2-l.x).toFixed(1), chars:t.length, est:+((100*(l.x2-l.x))/w).toFixed(1), size:+l.size.toFixed(1), uni:!!l.sizeUnified, inkH:l.inkH?+l.inkH.toFixed(1):0, fam:edFam(l)};})};
 })()`),null,1));
 ws.close(); process.exit(0);
})().catch(e=>{console.log('EX',e.message);process.exit(1)});
