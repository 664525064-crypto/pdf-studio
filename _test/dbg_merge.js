const fs=require('fs'),path=require('path');
const PORT=9234;
(async()=>{
 const list=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
 const page=list.find(t=>t.type==='page');
 const ws=new WebSocket(page.webSocketDebuggerUrl);
 await new Promise(r=>ws.onopen=r);
 let seq=0; const pend=new Map();
 ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);} };
 const send=(method,params,to=20000)=>new Promise((res,rej)=>{const id=++seq;pend.set(id,res);ws.send(JSON.stringify({id,method,params:params||{}}));setTimeout(()=>{if(pend.has(id)){pend.delete(id);rej(new Error('timeout '+method));}},to)});
 const ev=async(expr,to=20000)=>{const m=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true},to); if(m.result.exceptionDetails) return {ERR:JSON.stringify(m.result.exceptionDetails).slice(0,400)}; return m.result.result.value;};
 console.log('state', JSON.stringify(await ev(`({tool:__PS.state&&__PS.state.tool, files:__PS.state&&__PS.state.files&&__PS.state.files.length, busy:!!window.__BUSY__, modal:document.querySelector('.modal.show')?'yes':'no'})`)));
 const bA=fs.readFileSync('C:/Users/Administrator/WorkBuddy/2026-11-16-19-18-26/pdf-studio/_test/test-a.pdf').toString('base64');
 console.log('add', JSON.stringify(await ev(`__PS.selectTool('merge').then(()=>'ok')`)));
 console.log('addf', JSON.stringify(await ev(`__PS.testAddFile('a.pdf','${bA}').then(()=>'ok')`,30000)));
 console.log('run', JSON.stringify(await ev(`__PS.testRun().then(()=>'done',e=>'rej:'+e.message)`,120000)));
 console.log('saved', JSON.stringify(await ev(`__PS_SAVED__.map(f=>f.name+':'+f.bytes.length)`)));
 ws.close(); process.exit(0);
})().catch(e=>{console.log('EX',e.message);process.exit(1)});
