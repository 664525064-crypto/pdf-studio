const fs=require('fs');
const PORT=process.env.CDP_PORT||9234;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  let list; for(let i=0;i<20;i++){ try{ list=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; }catch(e){ await sleep(800);} }
  const page=list.find(t=>t.type==='page');
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  let seq=0; const pending=new Map(); const ctxs=[];
  ws.onmessage=ev=>{ const m=JSON.parse(ev.data);
    if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}
    if(m.method==='Runtime.executionContextCreated') ctxs.push(m.params.context); };
  const send=(method,params)=>new Promise((res,rej)=>{ const id=++seq; pending.set(id,m=>m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)); ws.send(JSON.stringify({id,method,params:params||{}})); setTimeout(()=>{ if(pending.has(id)){pending.delete(id);rej(new Error('timeout '+method));} },400000); });
  await send('Runtime.enable'); await sleep(1200);
  const ctx=ctxs.find(c=>!c.name)||ctxs[ctxs.length-1];
  const ev=async e=>{ const r=await send('Runtime.evaluate',{expression:e,contextId:ctx.id,awaitPromise:true,returnByValue:true,userGesture:true}); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception||r.exceptionDetails.text).slice(0,500)); return r.result.value; };
  const bA=fs.readFileSync('test-a.pdf').toString('base64');

  // 1) 造一个「扫描件」：把第 1 页渲染成图片再包成 PDF（无文字层）
  const scan=await ev(`(async()=>{ window.__E2E__=1;
    await __PS.testOpenDoc('test-a.pdf','${bA}');
    const pic=await __PS.testPagePng(0,2);
    const doc=await PDFLib.PDFDocument.create();
    const pg=doc.addPage([595.28,841.89]);
    const img=await doc.embedPng(pic.bytes);
    pg.drawImage(img,{x:0,y:0,width:595.28,height:841.89});
    const b=await doc.save();
    let s=''; for(let i=0;i<b.length;i++) s+=String.fromCharCode(b[i]);
    return btoa(s);
  })()`);
  fs.writeFileSync('scan.pdf', Buffer.from(scan,'base64'));
  const t=await ev(`(async()=>{ await __PS.testOpenDoc('scan.pdf','${scan}'); const r=await __PS.testLines(0,'text'); return {textLines:r.lines.length, pages:__PS.state.pageCount}; })()`);
  console.log('扫描件文字层:', JSON.stringify(t));

  // 2) 扫描件 → Word（自动 OCR）
  let t0=Date.now();
  const w=await ev(`(async()=>{ __PS_SAVED__.length=0; document.querySelectorAll('#thumbs .pg input').forEach(i=>{ if(!i.checked) i.click(); });
    __PS.selectTool('p2docx');
    document.getElementById('f_dmode').value='auto';
    await __PS.testRun();
    const f=__PS_SAVED__[0];
    if(!f) return {err:document.getElementById('status').textContent};
    const txt=new TextDecoder().decode(f.bytes);
    const hits=txt.split('<w:t').length-1;
    return {name:f.name, size:f.bytes.length, runs:hits, sample:(function(){ var i=txt.indexOf('<w:t'); if(i<0) return ''; var j=txt.indexOf('>',i)+1; var k=txt.indexOf('<',j); return txt.slice(j,k).slice(0,60); })(), status:document.getElementById('status').textContent};
  })()`);
  console.log('Word(auto OCR) ' + ((Date.now()-t0)/1000).toFixed(1)+'s:', JSON.stringify(w));

  // 3) 扫描件 → Excel（自动 OCR）
  t0=Date.now();
  const x=await ev(`(async()=>{ __PS_SAVED__.length=0; __PS.selectTool('p2xlsx'); document.getElementById('f_xmode').value='auto'; await __PS.testRun();
    const f=__PS_SAVED__[0]; if(!f) return {err:document.getElementById('status').textContent};
    const txt=new TextDecoder().decode(f.bytes);
    return {name:f.name, size:f.bytes.length, cells:txt.split('<c r=').length-1, status:document.getElementById('status').textContent};
  })()`);
  console.log('Excel(auto OCR) ' + ((Date.now()-t0)/1000).toFixed(1)+'s:', JSON.stringify(x));

  // 4) 扫描件 → PPT（文字模式，应自动 OCR 回退）
  t0=Date.now();
  const p=await ev(`(async()=>{ __PS_SAVED__.length=0; __PS.selectTool('p2pptx'); document.getElementById('f_pmode').value='text'; await __PS.testRun();
    const f=__PS_SAVED__[0]; if(!f) return {err:document.getElementById('status').textContent};
    const txt=new TextDecoder().decode(f.bytes);
    return {name:f.name, size:f.bytes.length, tx:txt.split('<a:t>').length-1, status:document.getElementById('status').textContent};
  })()`);
  console.log('PPT(text→OCR) ' + ((Date.now()-t0)/1000).toFixed(1)+'s:', JSON.stringify(p));

  // 5) 扫描件 → Word（图片模式）
  t0=Date.now();
  const im=await ev(`(async()=>{ __PS_SAVED__.length=0; __PS.selectTool('p2docx'); document.getElementById('f_dmode').value='img'; await __PS.testRun();
    const f=__PS_SAVED__[0]; if(!f) return {err:document.getElementById('status').textContent};
    const txt=new TextDecoder('latin1').decode(f.bytes);
    return {name:f.name, size:f.bytes.length, hasPng:txt.includes('word/media/page1.png'), status:document.getElementById('status').textContent};
  })()`);
  console.log('Word(img) ' + ((Date.now()-t0)/1000).toFixed(1)+'s:', JSON.stringify(im));
  ws.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
