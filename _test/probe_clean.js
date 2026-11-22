const fs=require('fs');
const PORT=process.env.CDP_PORT||9235;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  let list; for(let i=0;i<20;i++){ try{ list=await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; }catch(e){ await sleep(800);} }
  const page=list.find(t=>t.type==='page');
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  let seq=0; const pending=new Map(); const ctxs=[];
  ws.onmessage=ev=>{ const m=JSON.parse(ev.data); if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);} if(m.method==='Runtime.executionContextCreated') ctxs.push(m.params.context); };
  const send=(method,params)=>new Promise((res,rej)=>{ const id=++seq; pending.set(id,m=>m.error?rej(new Error(JSON.stringify(m.error))):res(m.result)); ws.send(JSON.stringify({id,method,params:params||{}})); setTimeout(()=>{ if(pending.has(id)){pending.delete(id);rej(new Error('timeout '+method));} },60000); });
  await send('Runtime.enable'); await sleep(1000);
  const ctx=ctxs.find(c=>!c.name)||ctxs[ctxs.length-1];
  const ev=async e=>{ const r=await send('Runtime.evaluate',{expression:e,contextId:ctx.id,awaitPromise:true,returnByValue:true,userGesture:true}); if(r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception||r.exceptionDetails.text).slice(0,400)); return r.result.value; };
  const out=await ev(`(async()=>{
    window.__E2E__=1; __PS_SAVED__.length=0;
    await __PS.openEditor(0);
    const L=(await __PS.testFindLine(0,'Sample'));
    await __PS.testEditLine(0, L.i, '已修改：合同编号已更新', '#c53a25');
    const rec=__PS.editor.edits[0];
    await __PS.testSaveEdits(); const bytes=__PS_SAVED__[__PS_SAVED__.length-1].bytes;
    const d=await pdfjsLib.getDocument({data:bytes.slice()}).promise;
    const pg=await d.getPage(1);
    const scale=2, vp=pg.getViewport({scale});
    const cv=document.createElement('canvas'); cv.width=vp.width; cv.height=vp.height;
    await pg.render({canvasContext:cv.getContext('2d'), viewport:vp, intent:'print'}).promise;
    const c2=cv.getContext('2d');
    const H=pg.getViewport({scale:1}).height;
    // rect in pdf coords
    const rx=rec.x-6, ry=rec.y-rec.h*0.32, rw=rec.w+6, rh=rec.h*1.42;
    const cvX=rx*scale, cvY=(H-(ry+rh))*scale, cvW=rw*scale, cvH=rh*scale;
    const im=c2.getImageData(Math.round(cvX),Math.round(cvY),Math.round(cvW),Math.round(cvH)).data;
    let dark=0; for(let i=0;i<im.length;i+=4){ if(im[i]<200&&im[i+1]<200&&im[i+2]<200) dark++; }
    // 新文字右缘之后（红色区域右侧）是否还有黑色残留
    let redMaxX=-1;
    for(let y=0;y<cvH;y++){ for(let x=0;x<cvW;x++){ const i=(y*Math.round(cvW)+x)*4; if(im[i]>150&&im[i+1]<110&&im[i+2]<110){ if(x>redMaxX) redMaxX=x; } } }
    let tailDark=0;
    if(redMaxX>=0){ for(let y=0;y<cvH;y++){ for(let x=redMaxX+6;x<cvW;x++){ const i=(y*Math.round(cvW)+x)*4; if(im[i]<200&&im[i+1]<200&&im[i+2]<200) tailDark++; } } }
    // 矩形下方一条带（可能存在下伸笔画）
    const band=c2.getImageData(Math.round(cvX),Math.round(cvY+cvH),Math.round(cvW),18).data;
    let below=0; for(let i=0;i<band.length;i+=4){ if(band[i]<200&&band[i+1]<200&&band[i+2]<200) below++; }
    const up=c2.getImageData(Math.round(cvX),Math.round(cvY-20),Math.round(cvW),18).data;
    let above=0; for(let i=0;i<up.length;i+=4){ if(up[i]<200&&up[i+1]<200&&up[i+2]<200) above++; }
    return {len:bytes.length, rect:{rx:+rx.toFixed(1),ry:+ry.toFixed(1),rw:+rw.toFixed(1),rh:+rh.toFixed(1)}, dark, redMaxX, tailDark, below, above};
  })()`, 120000);
  console.log(JSON.stringify(out,null,1));
  ws.close();
})().catch(e=>{console.error('ERR',e.message);process.exit(1);});
