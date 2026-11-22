/* 探针：段落识别 + 整段重排 + 改字颜色 */
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
  const sendMain = (method, params, timeout) => send(method, Object.assign({ contextId: main.id }, params || {}), timeout);
  return { ws, send: sendMain };
}
async function evalJS(send, expr, timeout = 60000) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }, timeout);
  if (r.exceptionDetails) throw new Error('JS: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0, 600));
  return r.result.value;
}

const GEN = `(async()=>{
  const {PDFDocument, rgb}=PDFLib;
  const doc=await PDFDocument.create();
  doc.registerFontkit(window.fontkit);
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
  const wrap=(t,lim)=>{
    const out=[]; let line='';
    for(const ch of t){ const test=line+ch; if(font.widthOfTextAtSize(test,size)>lim && line){ out.push(line); line=ch; } else line=test; }
    if(line) out.push(line); return out;
  };
  let y=780, rows=0;
  paras.forEach((p,pi)=>{
    const ls=wrap(p, pi===0?maxW-size*2:maxW);
    ls.forEach((t,k)=>{ page.drawText(t,{x:left+(k===0&&pi===0?size*2:0), y, size, font, color:rgb(0,0,0)}); y-=lead; rows++; });
    y-=lead*0.4;
  });
  const bytes=await doc.save();
  let bin=''; const CH=8192;
  for(let i=0;i<bytes.length;i+=CH) bin+=String.fromCharCode.apply(null, bytes.subarray(i,i+CH));
  return { b64: btoa(bin), rows };
})()`;

(async () => {
  const { ws, send } = await connect();
  await evalJS(send, `window.__E2E__=true`);
  const gen = await evalJS(send, GEN, 60000);
  console.log('生成样本 rows=', gen.rows);
  await evalJS(send, `__PS.testOpenDoc('para.pdf', ${JSON.stringify(gen.b64)})`, 60000);
  const paras = await evalJS(send, `(async()=>{ await __PS.openEditor(0); return __PS.testParas(); })()`, 90000);
  console.log('段落分组:', JSON.stringify(paras, null, 1));

  const ed = await evalJS(send, `__PS.testParaEdit(0, 0, '（一）保险标的造成的第三者损失：在保险期间内，被保险人及其允许的驾驶人在使用保险车辆过程中发生意外事故，致使第三者遭受人身伤亡或者财产的直接损毁，依法应当由被保险人承担的经济赔偿责任，保险人依照保险合同的规定负责赔偿。\\n第二段文字是新加上去的，用来验证整段能否自动往下排，并且首行缩进、行距、字号都跟原文保持一致。')`, 90000);
  console.log('整段编辑:', JSON.stringify(ed, null, 1));

  const sv = await evalJS(send, `(async()=>{ const r=await __PS.testSaveEdits(); const u8=__PS_SAVED__[__PS_SAVED__.length-1].bytes;
     const d=await pdfjsLib.getDocument({data:u8.slice()}).promise; const pg=await d.getPage(1); const tc=await pg.getTextContent();
     const t=tc.items.map(i=>i.str).join('');
     return { len:u8.length, has1:t.includes('第二段文字是新加上去的'), nItems:tc.items.length,
              fonts:[...new Set(tc.items.map(i=>(tc.styles[i.fontName]||{}).fontFamily))] };
  })()`, 180000);
  console.log('保存:', JSON.stringify(sv));

  // 把保存后的 PDF 第 1 页渲染成 PNG（不依赖窗口截图，稳定）
  const png = await evalJS(send, `(async()=>{
    const u8=__PS_SAVED__[__PS_SAVED__.length-1].bytes;
    const d=await pdfjsLib.getDocument({data:u8.slice()}).promise;
    const pg=await d.getPage(1); const vp=pg.getViewport({scale:1.6});
    const cv=document.createElement('canvas'); cv.width=vp.width; cv.height=vp.height;
    const cx=cv.getContext('2d'); cx.fillStyle='#fff'; cx.fillRect(0,0,cv.width,cv.height);
    await pg.render({canvasContext:cx, viewport:vp, intent:'print'}).promise;
    return cv.toDataURL('image/png').split(',')[1];
  })()`, 120000);
  fs.writeFileSync(path.join(__dirname, 'para-saved.png'), Buffer.from(png, 'base64'));
  console.log('已渲染保存结果 para-saved.png');

  try {
    await send('Page.bringToFront', {}, 5000);
    await sleep(400);
    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true }, 20000);
    fs.writeFileSync(path.join(__dirname, 'para-edit.png'), Buffer.from(shot.data, 'base64'));
  } catch (e) { console.log('截图失败', e.message); }
  ws.close();
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
