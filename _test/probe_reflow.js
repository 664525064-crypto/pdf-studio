/* 探针：复现「整段改长」场景，dump 记录与重排决策 */
const CDP = process.env.CDP_PORT || 9234;

(async()=>{
  const list = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
  const page = list.find(t=>t.type==='page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id=0; const pend=new Map();
  ws.onmessage = m=>{ const d=JSON.parse(m.data); if(d.id&&pend.has(d.id)){ pend.get(d.id)(d); pend.delete(d.id); } };
  await new Promise((res,rej)=>{ ws.onopen=res; ws.onerror=rej; });
  const send=(method,params)=>new Promise((res)=>{ const i=++id; pend.set(i,res); ws.send(JSON.stringify({id:i,method,params})); });

  const expr = `(async()=>{
    const {PDFDocument, rgb}=PDFLib;
    const doc=await PDFDocument.create(); doc.registerFontkit(window.fontkit);
    const fb=await window.__PDFSTUDIO_BRIDGE__.font('song');
    const font=await doc.embedFont(fb.bytes,{subset:true});
    const pg=doc.addPage([595,842]);
    const size=12, lead=20, left=72, maxW=595-144;
    const paras=[
      '（一）保险标的造成的第三者损失：在保险期间内，被保险人及其允许的驾驶人在使用保险车辆过程中发生意外事故，致使第三者遭受人身伤亡或者财产的直接损毁，依法应当由被保险人承担的经济赔偿责任，保险人依照本保险合同的规定负责赔偿。',
      '（二）保险标的自身缺陷、保管不善导致的损毁，保险标的的氧化、腐蚀、锈损、自然损耗、自然磨损所造成的损失和费用；',
      '（三）需经常更换的工具和配件（如：打击锤、钻头、皮带、绳索、金属线等）、易损的玻璃配件（如：挡风玻璃、倒车镜、灯泡等）的单独损坏，以及车身表面油漆单独划伤所造成的损失和费用；',
      '（四）保险标的发动机进水后导致发动机的损失。'
    ];
    const wrap=(t,lim)=>{ const o=[]; let line=''; for(const ch of t){ const s=line+ch; if(font.widthOfTextAtSize(s,size)>lim&&line){o.push(line);line=ch;} else line=s; } if(line)o.push(line); return o; };
    let y=780;
    paras.forEach((p,pi)=>{ const ls=wrap(p, pi===0?maxW-size*2:maxW); ls.forEach((t,k)=>{ pg.drawText(t,{x:left+(k===0&&pi===0?size*2:0), y, size, font, color:rgb(0,0,0)}); y-=lead; }); y-=lead*0.4; });
    const bytes=await doc.save(); let bin='';
    for(let i=0;i<bytes.length;i+=8192) bin+=String.fromCharCode.apply(null, bytes.subarray(i,i+8192));
    const genPara=btoa(bin);

    await __PS.testResetEdits();
    await __PS.testOpenDoc('para.pdf', genPara);
    await new Promise(r=>setTimeout(r,1500));
    await __PS.openEditor(0);
    await new Promise(r=>setTimeout(r,1500));
    const r1 = await __PS.testParaEdit(0, 0, '（一）保险标的造成的第三者损失：在保险期间内，被保险人及其允许的驾驶人在使用保险车辆过程中发生意外事故，致使第三者遭受人身伤亡或者财产的直接损毁，依法应当由被保险人承担的经济赔偿责任，保险人依照本保险合同的规定负责赔偿。\\n本段新增了一行说明文字，用来验证段落改长之后的效果。');
    const rec = ED.edits.filter(e=>e.multi).pop();
    const P=edParaInfo(0);
    return { r1opened:r1&&r1.opened, editsN:ED.edits.length,
      rec: rec ? { w:Math.round(rec.w), nOld:rec.nOld, indent:rec.indent, lead:rec.lead,
        reflow: rec.reflow ? { n:rec.reflow.below.length, yMin:rec.reflow.yMin, ys:rec.reflow.below.map(b=>b.y) } : null } : null,
      para: P ? { n:P.n, x0:P.x0, x1:P.x1, y0:P.y0, yEnd:P.yEnd } : null,
      availW: P?Math.round(edAvailW(P)):null,
      estRows: rec && rec.text ? wrapParaCss(rec.text, famCss(rec.fam), rec.size, rec.w, rec.indent||0).length : null,
      estTail: rec && rec.text ? wrapParaCss(rec.text, famCss(rec.fam), rec.size, rec.w, rec.indent||0).slice(-2).map(r=>r.t.slice(0,14)) : null,
      reflowCk: $('edReflowCk') ? $('edReflowCk').checked : 'no-el' };
  })()`;

  const raw = await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
  if(raw.result && raw.result.exceptionDetails) console.log('EXC:', JSON.stringify(raw.result.exceptionDetails).slice(0,600));
  console.log('VAL:', JSON.stringify(raw.result && raw.result.result && raw.result.result.value));
  ws.close(); process.exit(0);
})().catch(e=>{ console.error('FATAL', e.message); process.exit(2); });
