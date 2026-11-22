/* 验证文字层（非 OCR）路径：改字颜色 = 纯黑，且写进 PDF 的内容流也是 0 0 0 rg */
const PORT = 9234;
const fs = require('fs'), path = require('path');
async function conn() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params, timeout = 180000) => new Promise((res, rej) => {
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

const RUN = `(async()=>{
  window.__E2E__=1;
  const PL=PDFLib_, doc=await PL.PDFDocument.create();
  const f=await doc.embedFont(PL.StandardFonts.Helvetica);
  const p=doc.addPage([595,842]);
  const rows=['Insurance clause article three begins here,',
              'the insurer shall not be liable for any loss',
              'caused by theft, robbery or snatch during',
              'the period of transportation by the carrier.'];
  rows.forEach((t,i)=> p.drawText(t,{x:56,y:760-i*20,size:12,font:f,color:PL.rgb(0,0,0)}));
  const bytes=await doc.save({useObjectStreams:true});
  let bin=''; const CH=0x8000;
  for(let i=0;i<bytes.length;i+=CH) bin+=String.fromCharCode.apply(null, bytes.subarray(i,i+CH));
  await __PS.testOpenDoc('text-ink.pdf', btoa(bin));
  await __PS.openEditor(0);
  for(let k=0;k<40;k++){ await new Promise(r=>setTimeout(r,300));
    const E=__PS.editor; if(E&&E.lines&&E.lines.length) break; }
  const E=__PS.editor;
  const lum=h=>{ const m=String(h||'').match(/^#(..)(..)(..)$/); return m?Math.round(0.299*parseInt(m[1],16)+0.587*parseInt(m[2],16)+0.114*parseInt(m[3],16)):-1; };
  const inks=E.lines.filter(l=>l.text&&l.text.trim()).map(l=>({t:l.text.slice(0,16), ink:l.ink, lum:lum(l.ink)}));

  /* 改第一行 → 提交 */
  const i=0;
  document.querySelector('.tline[data-i="'+i+'"]').click();
  await new Promise(r=>setTimeout(r,250));
  const d=document.querySelector('.edin'); if(!d) return {noBox:true, inks};
  const boxColor=d.style.color;
  d.innerText='Insurance clause article three (revised)';
  edCommitInline();
  await new Promise(r=>setTimeout(r,250));
  const rec=(__PS.editor.edits||[]).slice(-1)[0];
  window.__PS_SAVED__.length=0;
  const sv=await __PS.testSaveEdits();
  return {inks, boxColor, recColor:rec&&rec.color, recText:rec&&rec.text, multi:!!(rec&&rec.multi),
    nSaved:(window.__PS_SAVED__||[]).length, sv};
})()`;

(async () => {
  const { ws, ev } = await conn();
  const r = await ev(RUN);
  console.log('=== 文字层每行墨色 ===');
  for (const x of r.inks || []) console.log(JSON.stringify(x));
  const bad = (r.inks || []).filter(x => x.lum > 40);
  console.log(bad.length ? 'FAIL 偏浅: ' + JSON.stringify(bad) : 'PASS 文字层也是纯黑');
  console.log('box color', r.boxColor, '| rec color', r.recColor, '| multi', r.multi, '| nSaved', r.nSaved);
  console.log('recText', JSON.stringify(r.recText));
  console.log(r.recColor === '#000000' || r.recColor === 'rgb(0, 0, 0)' ? 'PASS 写入颜色=纯黑' : 'FAIL 写入颜色 ' + r.recColor);

  /* 读回 PDF：渲染出来逐行量"最暗像素"，改过那行不能比原文浅 */
  const chk = await ev(`(async()=>{
    const b=window.__PS_SAVED__[0]; if(!b) return {noSave:true};
    const jd=await pdfjsLib.getDocument({data:b.bytes.slice(),disableWorker:true}).promise;
    const pg=await jd.getPage(1);
    const sc=2, vp=pg.getViewport({scale:sc});
    const cv=document.createElement('canvas'); cv.width=Math.round(vp.width); cv.height=Math.round(vp.height);
    const ctx=cv.getContext('2d',{willReadFrequently:true});
    await pg.render({canvasContext:ctx, viewport:vp, intent:'print'}).promise;
    const d=ctx.getImageData(0,0,cv.width,cv.height).data, W=cv.width;
    const lum=(x,y)=>{ const i=(y*W+x)*4; return 0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; };
    const darkest=(x0,x1,y0,y1)=>{
      const arr=[];
      for(let y=Math.max(0,y0);y<Math.min(cv.height,y1);y++)
        for(let x=Math.max(0,x0);x<Math.min(W,x1);x++){ const l=lum(x,y); if(l<200) arr.push(l); }
      arr.sort((a,b2)=>a-b2);
      return arr.length? Math.round(arr.slice(0, Math.max(3, Math.floor(arr.length*0.10))).reduce((a,v)=>a+v,0)/Math.max(3,Math.floor(arr.length*0.10))) : null;
    };
    /* PDF y=760 是第一行基线（改过），740 是第二行（原文） */
    const band=(yPt)=>[Math.round((842-yPt-13)*sc), Math.round((842-yPt+4)*sc)];
    const [a0,a1]=band(760), [b0,b1]=band(740);
    /* 逐 4pt 带扫一遍，看暗像素都落在哪些 y（确认原文那几行还在不在） */
    const bands=[];
    for(let yPt=780;yPt>700;yPt-=4){ const [y0,y1]=band(yPt); const v=darkest(100,540,y0,y1); if(v!=null) bands.push(yPt+':'+v); }
    const tc=await pg.getTextContent();
    return {bytes:b.bytes.length, edited:darkest(100,540,a0,a1), original:darkest(100,540,b0,b1),
            bands, text:tc.items.map(i=>i.str).slice(0,8)};
  })()`);
  console.log('=== 保存后渲染：改过行 vs 原文行 最暗像素 ===');
  console.log(JSON.stringify(chk));
  const d0 = Math.abs((chk.edited||0) - (chk.original||0));
  console.log(d0 <= 12 ? 'PASS 两行墨色一致（差 ' + d0 + '）' : 'FAIL 改过行偏浅（差 ' + d0 + '）');

  const shot = await ev(`window.__PDFSTUDIO_BRIDGE__.shot()`);
  fs.writeFileSync(path.join(__dirname, 'ui-ink-text.png'), Buffer.from(shot, 'base64'));
  ws.close(); process.exit(0);
})().catch(e => { console.log('EX', e.message); process.exit(1); });
