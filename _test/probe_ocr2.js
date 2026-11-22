const fs=require('fs');
const PORT=process.env.CDP_PORT||9234;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  let list; for(let i=0;i<20;i++){ try{ list=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; }catch(e){ await sleep(800);} }
  const ws=new WebSocket(list.find(t=>t.type==='page').webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  let seq=0; const pending=new Map(); const ctxs=[];
  ws.onmessage=ev=>{ const m=JSON.parse(ev.data); if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);} if(m.method==='Runtime.executionContextCreated') ctxs.push(m.params.context); };
  const send=(method,params)=>new Promise((res,rej)=>{ const id=++seq; pending.set(id,m=>m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)); ws.send(JSON.stringify({id,method,params:params||{}})); setTimeout(()=>{ if(pending.has(id)){pending.delete(id);rej(new Error('timeout '+method));} },300000); });
  await send('Runtime.enable'); await sleep(1000);
  const ctx=ctxs.find(c=>!c.name)||ctxs[ctxs.length-1];
  const ev=async e=>{ const r=await send('Runtime.evaluate',{expression:e,contextId:ctx.id,awaitPromise:true,returnByValue:true,userGesture:true}); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception||r.exceptionDetails.text).slice(0,400)); return r.result.value; };
  const bB=fs.readFileSync('test-b.pdf').toString('base64');
  const t0=Date.now();
  const out=await ev(`(async()=>{
    window.__E2E__=1; await __PS.testOpenDoc('test-b.pdf','${bB}');
    const truth=(await __PS.testLines(0,'text')).lines.map(l=>l.text).join('');
    const t1=performance.now();
    const ocr=await __PS.testOcr(0,2.4);
    const dt=Math.round(performance.now()-t1);
    const got=ocr.map(l=>l.text).join('');
    const set=new Set(got.replace(/\s/g,'').split(''));
    let hit=0; for(const ch of truth.replace(/\s/g,'')) if(set.has(ch)) hit++;
    const denom=Math.max(1,truth.replace(/\s/g,'').length);
    return {ms:dt, truthLen:denom, ocrLen:got.length, charRecall:+(hit/denom).toFixed(3),
      ocrHead:ocr.slice(0,8).map(l=>l.text.slice(0,40)), truthHead:truth.slice(0,120)};
  })()`);
  console.log('elapsed ' + ((Date.now()-t0)/1000).toFixed(1) + 's');
  console.log(JSON.stringify(out,null,1));
  ws.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
