const fs=require('fs');
const PORT=9234;
const b64=n=>fs.readFileSync('_test/'+n).toString('base64');
(async()=>{
 const list=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
 const page=list.find(t=>t.type==='page');
 const ws=new WebSocket(page.webSocketDebuggerUrl); await new Promise(r=>ws.onopen=r);
 let seq=0; const pend=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);} };
 const send=(method,params,to=90000)=>new Promise((res,rej)=>{const id=++seq;pend.set(id,res);ws.send(JSON.stringify({id,method,params:params||{}}));setTimeout(()=>{if(pend.has(id)){pend.delete(id);rej(new Error('timeout '+method));}},to)});
 const ev=async(expr,to=90000)=>{const t0=Date.now();const m=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true},to); console.log('  took',Date.now()-t0,'ms'); if(m.result.exceptionDetails) return {ERR:JSON.stringify(m.result.exceptionDetails).slice(0,500)}; return m.result.result.value;};
 const bA=b64('test-a.pdf'), bB=b64('test-b.pdf');
 console.log('len', bA.length, bB.length);
 console.log(await ev(`window.__PS_SAVED__.length=0; (async()=>{ __PS.selectTool('merge'); await __PS.testAddFile('test-a.pdf','${bA}'); await __PS.testAddFile('test-b.pdf','${bB}'); await __PS.testRun(); return __PS_SAVED__.length; })()`));
 console.log('saved', JSON.stringify(await ev(`__PS_SAVED__.map(f=>f.name+':'+f.bytes.length)`)));
 ws.close(); process.exit(0);
})().catch(e=>{console.log('EX',e.message);process.exit(1)});
