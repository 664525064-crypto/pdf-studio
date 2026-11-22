/* 截图探针：打开编辑器并截 UI（用主进程 capturePage） */
const CDP = process.env.CDP_PORT || 9234;
const fs = require('fs');

(async()=>{
  const list = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
  const page = list.find(t=>t.type==='page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id=0; const pend=new Map();
  ws.onmessage = m=>{ const d=JSON.parse(m.data); if(d.id&&pend.has(d.id)){ pend.get(d.id)(d); pend.delete(d.id); } };
  await new Promise((res,rej)=>{ ws.onopen=res; ws.onerror=rej; });
  const send=(method,params)=>new Promise((res)=>{ const i=++id; pend.set(i,res); ws.send(JSON.stringify({id:i,method,params})); });
  const evalJS=async expr=>{
    const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
    if(r.result&&r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0,400));
    return r.result&&r.result.result&&r.result.result.value;
  };

  const gen=await evalJS(`(async()=>{
    const {PDFDocument, rgb}=PDFLib;
    const doc=await PDFDocument.create(); doc.registerFontkit(window.fontkit);
    const fb=await window.__PDFSTUDIO_BRIDGE__.font('song');
    const font=await doc.embedFont(fb.bytes,{subset:true});
    const pg=doc.addPage([595,842]);
    const size=12, lead=20, left=72, maxW=595-144;
    const paras=['项目管理流程说明','1、甲列表项目内容说明第一项的正文内容；','2、乙列表项目内容说明第二项的正文内容；','3、丙列表项目内容说明第三项的正文内容；','结尾段落说明文字内容，位于页面底部用来验证下方让位。'];
    const wrap=(t,lim)=>{ const o=[]; let line=''; for(const ch of t){ const s=line+ch; if(font.widthOfTextAtSize(s,size)>lim&&line){o.push(line);line=ch;} else line=s; } if(line)o.push(line); return o; };
    let y=780;
    paras.forEach(p=>{ wrap(p,maxW).forEach(t=>{ pg.drawText(t,{x:left,y,size,font,color:rgb(0,0,0)}); y-=lead; }); y-=lead*0.4; });
    const bytes=await doc.save(); let bin='';
    for(let i=0;i<bytes.length;i+=8192) bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));
    return btoa(bin);
  })()`, 60000);

  await evalJS(`(async()=>{
    await __PS.testResetEdits();
    await __PS.testOpenDoc('doc_ui.pdf', '${gen}');
    await new Promise(r=>setTimeout(r,1000));
    await __PS.openEditor(0);
    await new Promise(r=>setTimeout(r,1500));
    const i=ED.lines.findIndex(l=>(l.text||'').indexOf('项目管理流程')===0);
    document.querySelector('.tline[data-i="'+i+'"]').click();
    await new Promise(r=>setTimeout(r,600));
    return 'ok';
  })()`, 60000);

  const b64 = await evalJS(`window.__PDFSTUDIO_BRIDGE__.shot()`, 30000);
  fs.writeFileSync('ui-aalayout.png', Buffer.from(b64,'base64'));
  console.log('saved ui-aalayout.png', Math.round(b64.length/1365), 'KB~');
  ws.close(); process.exit(0);
})().catch(e=>{ console.error('FATAL', e.message); process.exit(2); });
