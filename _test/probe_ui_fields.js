/* 出图 + 校验：①短字段加字后编辑框向右变长、不提前折行 ②保存后字色与原文一致 */
const PORT = process.env.CDP_PORT || 9234;
const fs = require('fs'), path = require('path');
async function conn() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params, timeout = 240000) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async expr => {
    const m = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 800));
    return m.result.result.value;
  };
  return { ws, ev };
}
const shot = async (ev, name) => {
  const b = await ev(`window.__PDFSTUDIO_BRIDGE__.shot()`);
  fs.writeFileSync(path.join(__dirname, name), Buffer.from(b, 'base64'));
  console.log('shot', name);
};

const GEN = `(async()=>{
  const {PDFDocument, rgb}=PDFLib;
  const doc=await PDFDocument.create(); doc.registerFontkit(window.fontkit);
  const fb=await window.__PDFSTUDIO_BRIDGE__.font('song');
  const font=await doc.embedFont(fb.bytes,{subset:true});
  const page=doc.addPage([595,842]);
  const size=10.5, left=72;
  const rows=[
    ['保险合同争议解决方式：  诉讼', 760],
    ['出单机构：  成都市锦江支公司综合部', 730],
    ['（成都）', 708],
    ['签单日期：    年   月   日', 676],
    ['保险人联系地址：  四川省成都市锦江区楷字宫南街57号', 646]
  ];
  for(const r of rows) page.drawText(r[0],{x:left,y:r[1],size,font,color:rgb(0,0,0)});
  const bytes=await doc.save(); let bin='';
  for(let i=0;i<bytes.length;i+=8192) bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192));
  return btoa(bin);
})()`;

(async () => {
  const { ev } = await conn();
  const b64 = await ev(GEN);
  await ev(`(async()=>{ window.__E2E__=1; await __PS.testOpenDoc('fields.pdf', ${JSON.stringify(b64)}); __PS.selectTool('edittext'); await __PS.openEditor(0); })()`);

  /* 点「签单日期」那一行 → 输入更长的日期，看框是否向右长 */
  const typing = await ev(`(async()=>{
    const E=__PS.editor;
    const i=E.lines.findIndex(l=>l.text.indexOf('签单日期')>=0);
    document.querySelector('.tline[data-i="'+i+'"]').click();
    await new Promise(r=>setTimeout(r,120));
    const box=document.querySelector('.edin'); if(!box) return {err:'no box'};
    const w0=Math.round(box.getBoundingClientRect().width);
    box.focus(); box.textContent='签单日期：2026年09月77709日';
    box.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,120));
    const r=box.getBoundingClientRect();
    return { i, w0, w1:Math.round(r.width), h:Math.round(r.height), lines:(box.innerText||'').split('\\n').length,
             scrollH:box.scrollHeight, clientH:box.clientHeight };
  })()`);
  console.log('TYPING', JSON.stringify(typing));
  await shot(ev, 'ui-field-typing.png');

  /* 回车提交 → 预览层应是一行、且一直画到右边空地 */
  const committed = await ev(`(async()=>{
    const box=document.querySelector('.edin');
    box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,200));
    const ov=document.querySelector('.edov');
    const R=ov?ov.getBoundingClientRect():null;
    const E=__PS.editor;
    return { ovW:ov?Math.round(ov.offsetWidth):0, ovLeft:ov?Math.round(R.left):0, ovRight:ov?Math.round(R.right):0,
             stageW:Math.round(document.getElementById('edStage').getBoundingClientRect().width),
             rec:E.edits.length?{multi:!!E.edits[0].multi, w:Math.round(E.edits[0].w), color:E.edits[0].color, text:E.edits[0].text}:null };
  })()`);
  console.log('COMMIT', JSON.stringify(committed));
  await shot(ev, 'ui-field-committed.png');

  /* 保存 → 渲染读回：改过那行 vs 原文行的墨色；并读断行宽度 */
  const cmp = await ev(`(async()=>{
    window.__PS_SAVED__.length=0;
    await __PS.testSaveEdits();
    const u8=window.__PS_SAVED__[0].bytes;
    const d=await pdfjsLib.getDocument({data:u8.slice()}).promise;
    const pg=await d.getPage(1);
    const vp=pg.getViewport({scale:2});
    const cv=document.createElement('canvas'); cv.width=vp.width; cv.height=vp.height;
    const ctx=cv.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,cv.width,cv.height);
    await pg.render({canvasContext:ctx, viewport:vp, intent:'print'}).promise;
    const img=ctx.getImageData(0,0,cv.width,cv.height), D=img.data, W=cv.width;
    const lum=(x,y)=>{ const i=(y*W+x)*4; return 0.299*D[i]+0.587*D[i+1]+0.114*D[i+2]; };
    const darkest=(y0,y1)=>{ let mn=255; for(let y=y0;y<y1;y++) for(let x=0;x<W;x++){ const l=lum(x,y); if(l<mn) mn=l; } return Math.round(mn); };
    const items=(await pg.getTextContent()).items.filter(x=>x.str.trim());
    const bandOf=(it)=>{ const y=it.transform[5], h=it.height||10.5; return [Math.round((842-(y+h*0.95))*2), Math.round((842-(y-h*0.25))*2)]; };
    const itE=items.find(x=>x.str.indexOf('77709')>=0) || items.find(x=>x.str.indexOf('签单日期')>=0);
    const itO=items.find(x=>x.str.indexOf('保险人联系地址')>=0);
    const widths=items.map(x=>Math.round(x.width));
    window.__RENDER__=cv.toDataURL('image/png');
    return { edited:itE?darkest(...bandOf(itE)):null, origin:itO?darkest(...bandOf(itO)):null,
             editedText:itE?itE.str:'', editedW:itE?Math.round(itE.width):0, widths:widths,
             lineCount:items.length };
  })()`);
  console.log('COLOR', JSON.stringify(cmp));
  const png = await ev(`window.__RENDER__||''`);
  if (png) { fs.writeFileSync(path.join(__dirname, 'ui-field-saved.png'), Buffer.from(png.split(',')[1], 'base64')); console.log('shot ui-field-saved.png'); }

  /* 整段框：短字段段（2 行）改长 → 框宽到页面右边界，文字按页面宽度折行 */
  await ev(`(async()=>{ await __PS.testOpenDoc('fields.pdf', ${JSON.stringify(b64)}); __PS.selectTool('edittext'); await __PS.openEditor(0); })()`);
  const para = await ev(`(async()=>{
    const E=__PS.editor;
    const i=E.lines.findIndex(l=>l.text.indexOf('出单机构')>=0);
    document.querySelector('.tline[data-i="'+i+'"]').click();
    await new Promise(r=>setTimeout(r,150));
    const box=document.querySelector('.edin.para'); if(!box) return {err:'no para box'};
    box.focus();
    box.innerHTML='出单机构：成都市锦江支公司综合部（成都）·签单日期2026年09月15日·保险人联系地址四川省成都市锦江区楷字宫南街57号·本行故意写长，看会不会用到右边空地';
    box.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,200));
    const r=box.getBoundingClientRect();
    return { w:Math.round(r.width), h:Math.round(r.height), left:Math.round(r.left), right:Math.round(r.right),
             scrollW:box.scrollWidth, clientW:box.clientWidth };
  })()`);
  console.log('PARA', JSON.stringify(para));
  await shot(ev, 'ui-field-para.png');
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
