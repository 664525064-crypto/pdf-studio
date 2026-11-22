/* 探针2：改一个字 vs 原文的像素/坐标对比（验证整段重排不跑位） */
const fs = require('fs');
const path = require('path');
const PORT = process.env.CDP_PORT || 9234;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); const ctxs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.executionContextCreated') ctxs.push(m.params.context);
  };
  const send = (method, params, timeout = 20000) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, m => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  await send('Runtime.enable'); await send('Page.enable');
  await sleep(500);
  const main = ctxs.find(c => !c.name) || ctxs[ctxs.length - 1];
  return { ws, send: (m, p, t) => send(m, Object.assign({ contextId: main.id }, p || {}), t) };
}
async function evalJS(send, expr, timeout = 60000) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }, timeout);
  if (r.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0, 600));
  return r.result.value;
}

const GEN = `(async()=>{
  const {PDFDocument, rgb}=PDFLib;
  const doc=await PDFDocument.create(); doc.registerFontkit(window.fontkit);
  const fb=await window.__PDFSTUDIO_BRIDGE__.font('song');
  const font=await doc.embedFont(fb.bytes,{subset:true});
  const page=doc.addPage([595,842]);
  const size=12, lead=20, left=72, maxW=595-144;
  const paras=[
   '（一）保险标的造成的第三者损失：在保险期间内，被保险人及其允许的驾驶人在使用保险车辆过程中发生意外事故，致使第三者遭受人身伤亡或者财产的直接损毁，依法应当由被保险人承担的经济赔偿责任，保险人依照本保险合同的规定负责赔偿。',
   '（二）保险标的自身缺陷、保管不善导致的损毁，保险标的的氧化、腐蚀、锈损、自然损耗、自然磨损所造成的损失和费用；',
   '（三）需经常更换的工具和配件（如：打击锤、钻头、皮带、绳索、金属线等）、易损的玻璃配件（如：挡风玻璃、倒车镜、灯泡等）的单独损坏，以及车身表面油漆单独划伤所造成的损失和费用；',
   '（四）保险标的发动机进水后导致发动机的损失。'
  ];
  const wrap=(t,lim)=>{ const out=[]; let line=''; for(const ch of t){ const s=line+ch; if(font.widthOfTextAtSize(s,size)>lim&&line){out.push(line);line=ch;} else line=s; } if(line)out.push(line); return out; };
  let y=780;
  paras.forEach((p,pi)=>{ const ls=wrap(p, pi===0?maxW-size*2:maxW); ls.forEach((t,k)=>{ page.drawText(t,{x:left+(k===0&&pi===0?size*2:0), y, size, font, color:rgb(0,0,0)}); y-=lead; }); y-=lead*0.4; });
  const bytes=await doc.save();
  let bin=''; for(let i=0;i<bytes.length;i+=8192) bin+=String.fromCharCode.apply(null, bytes.subarray(i,i+8192));
  return btoa(bin);
})()`;

(async () => {
  const { ws, send } = await connect();
  await evalJS(send, `window.__E2E__=true`);
  const b64 = await evalJS(send, GEN, 60000);
  await evalJS(send, `__PS.testOpenDoc('para.pdf', ${JSON.stringify(b64)})`, 60000);
  const info = await evalJS(send, `(async()=>{ await __PS.openEditor(0); return __PS.testParas(); })()`, 90000);
  console.log('段落:', info.paras.map(p => p.n).join(','));

  // 段 2 原文
  const seg2 = await evalJS(send, `(()=>{ const pi=1, g=__PS.editor.paras[pi]; return g.map(i=>__PS.editor.lines[i].text).join(''); })()`);
  console.log('段2原文:', seg2);
  const edited = seg2.replace('自身缺陷', '自有瑕疵');
  const ed = await evalJS(send, `__PS.testParaEdit(0, 1, ${JSON.stringify(edited)})`, 90000);
  console.log('段2编辑:', JSON.stringify({ opened: ed.opened, n: ed.n, boxLines: ed.boxLines, rec: ed.rec && { size: ed.rec.size, lead: ed.rec.lead, w: ed.rec.w, indent: ed.rec.indent, color: ed.rec.color } }));

  const res = await evalJS(send, `(async()=>{
    const before=Uint8Array.from(atob(${JSON.stringify(b64)}),c=>c.charCodeAt(0));
    await __PS.testSaveEdits();
    const after=__PS_SAVED__[__PS_SAVED__.length-1].bytes;
    const render=async(bytes)=>{
      const d=await pdfjsLib.getDocument({data:bytes.slice()}).promise;
      const pg=await d.getPage(1); const vp=pg.getViewport({scale:2});
      const cv=document.createElement('canvas'); cv.width=Math.round(vp.width); cv.height=Math.round(vp.height);
      const cx=cv.getContext('2d'); cx.fillStyle='#fff'; cx.fillRect(0,0,cv.width,cv.height);
      await pg.render({canvasContext:cx, viewport:vp, intent:'print'}).promise;
      return { cv, cx, items:(await pg.getTextContent()).items.map(i=>({t:i.str, x:+i.transform[4].toFixed(1), y:+i.transform[5].toFixed(1)})) };
    };
    const A=await render(before), B=await render(after);
    const da=A.cx.getImageData(0,0,A.cv.width,A.cv.height).data, db=B.cx.getImageData(0,0,B.cv.width,B.cv.height).data;
    let diff=0, total=0, rows={};
    for(let y=0;y<A.cv.height;y++){ let rd=0;
      for(let x=0;x<A.cv.width;x++){ const i=(y*A.cv.width+x)*4;
        const d0=Math.abs(da[i]-db[i])+Math.abs(da[i+1]-db[i+1])+Math.abs(da[i+2]-db[i+2]);
        if(d0>90){ rd++; diff++; }
        if(da[i]<128) total++;
      }
      if(rd>3) rows[Math.round((A.cv.height-y)/2)] = rd;
    }
    function bbox(items, y0, y1){ const it=items.filter(i=>i.y<=y0+2 && i.y>=y1-2); return it.length?{x:Math.min(...it.map(i=>i.x)),x2:Math.max(...it.map(i=>i.x))}:null; }
    return { diffPix:diff, darkPix:total, diffRatio:+(diff/Math.max(1,total)).toFixed(3),
             changedRows:Object.keys(rows).slice(0,24),
             aItems:A.items.length, bItems:B.items.length,
             bboxA:bbox(A.items,720,660), bboxB:bbox(B.items,720,660),
             sample:B.items.filter(i=>i.y<700&&i.y>660).map(i=>i.t).join('') };
  })()`, 180000);
  console.log('对比:', JSON.stringify(res, null, 1));

  const png = await evalJS(send, `(async()=>{ const u8=__PS_SAVED__[__PS_SAVED__.length-1].bytes;
    const d=await pdfjsLib.getDocument({data:u8.slice()}).promise; const pg=await d.getPage(1); const vp=pg.getViewport({scale:1.6});
    const cv=document.createElement('canvas'); cv.width=vp.width; cv.height=vp.height; const cx=cv.getContext('2d');
    cx.fillStyle='#fff'; cx.fillRect(0,0,cv.width,cv.height);
    await pg.render({canvasContext:cx, viewport:vp, intent:'print'}).promise; return cv.toDataURL('image/png').split(',')[1]; })()`, 120000);
  fs.writeFileSync(path.join(__dirname, 'para-reword.png'), Buffer.from(png, 'base64'));
  ws.close(); process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
