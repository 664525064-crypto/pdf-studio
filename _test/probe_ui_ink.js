/* 出图 + 校验：①编辑框右下角可拉伸 ②改完字色与原文一致（渲染读回比色） */
const PORT = 9234;
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

const OPEN = `(async()=>{
  window.__E2E__=1;
  const W=1190,H=1684;
  const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
  const g=cv.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,W,H);
  g.fillStyle='#111';
  const px=pt=>pt*W/595;
  const txt=(s,x,y,size)=>{ g.font=size+'px "SimSun"'; g.fillText(s,px(x),px(y)); };
  txt('第四条 下列损失和费用，保险人也不负责赔偿：', 56, 120, px(12));
  txt('（一）保险标的造成的第三者损失；', 56, 155, px(12));
  txt('（二）保险标的的自身缺陷、保管不善导致的损毁，保险标的的氧化、腐蚀、锈损、', 56, 190, px(12));
  txt('自然损耗、自然磨损所造成的损失和费用；', 56, 208, px(12));
  txt('（三）需经常更换的工具和配件、易损的玻璃配件的单独损坏。', 56, 243, px(12));
  /* 轻噪点：模拟真实扫描件（黑字边缘出现灰阶，正是"改完显浅"的成因） */
  const id=g.getImageData(0,0,W,H), d=id.data;
  for(let i=0;i<d.length;i+=4){ if(d[i]>250 && Math.random()<0.05){ const v=232+Math.random()*20; d[i]=d[i+1]=d[i+2]=v; } }
  g.putImageData(id,0,0);
  const blob=await new Promise(r=>cv.toBlob(r,'image/png'));
  const PL=PDFLib_, doc=await PL.PDFDocument.create();
  const img=await doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
  doc.addPage([595,842]).drawImage(img,{x:0,y:0,width:595,height:842});
  const bytes=await doc.save({useObjectStreams:true});
  let bin=''; const CH=0x8000;
  for(let i=0;i<bytes.length;i+=CH) bin+=String.fromCharCode.apply(null, bytes.subarray(i,i+CH));
  await __PS.testOpenDoc('scan-color.pdf', btoa(bin));
  await __PS.openEditor(0);
  for(let k=0;k<60;k++){ await new Promise(r=>setTimeout(r,700));
    const E=__PS.editor; if(E && E.ocrDone && E.ocrDone[E.page] && E.lines && E.lines.length) break; }
  return {lines:__PS.editor.lines.filter(l=>l.text&&l.text.trim()).map(l=>l.text.slice(0,16)),
          paras:(__PS.editor.paras||[]).map(g=>g.length)};
})()`;

(async () => {
  const { ws, ev } = await conn();
  const info = await ev(OPEN);
  console.log('paras', JSON.stringify(info.paras));

  /* 1) 点一行独立段 → 拖右下角 +110 × +46 → 截图 */
  const grip = await ev(`(async()=>{
    const E=__PS.editor;
    const pi=(E.paras||[]).findIndex(g=>g.length===1);
    const i=(pi>=0)?E.paras[pi][0]:0;
    document.querySelector('.tline[data-i="'+i+'"]').click();
    await new Promise(r=>setTimeout(r,260));
    const d=document.querySelector('.edin'); if(!d) return {noBox:true};
    const r0=d.getBoundingClientRect();
    const mk=(t,cx,cy)=>new MouseEvent(t,{bubbles:true,cancelable:true,clientX:cx,clientY:cy,view:window});
    const X=Math.round(r0.right-7), Y=Math.round(r0.bottom-7);
    d.dispatchEvent(mk('mousedown',X,Y));
    document.dispatchEvent(mk('mousemove',X+110,Y+46));
    document.dispatchEvent(mk('mouseup',X+110,Y+46));
    await new Promise(r=>setTimeout(r,150));
    const r1=d.getBoundingClientRect();
    return {before:[Math.round(r0.width),Math.round(r0.height)], after:[Math.round(r1.width),Math.round(r1.height)],
      flag:d.dataset.manSize||'', color:d.style.color, hint:document.getElementById('edHint').textContent};
  })()`);
  console.log('GRIP', JSON.stringify(grip));
  await shot(ev, 'ui-grip.png');

  /* 2) 改这一行 → 截图 → 提交保存 */
  const edit = await ev(`(async()=>{
    const d=document.querySelector('.edin'); if(!d) return {gone:true};
    const before=d.innerText;
    d.innerText=before.replace(/[：:]$/,'')+'。';   // 原文末尾有冒号，改成句号（确实不同）
    d.dispatchEvent(new Event('input',{bubbles:true}));
    await new Promise(r=>setTimeout(r,150));
    const rec0=(()=>{ edCommitInline(); return (__PS.editor.edits||[]).slice(-1)[0]; })();
    await new Promise(r=>setTimeout(r,200));
    window.__PS_SAVED__.length=0;
    const sv=await __PS.testSaveEdits();
    return {before, rec:rec0, recColor:rec0&&rec0.color, recText:rec0&&rec0.text.slice(0,18),
      nSaved:window.__PS_SAVED__.length};
  })()`);
  console.log('EDIT', JSON.stringify(edit));
  await shot(ev, 'ui-ink-after.png');

  /* 3) 读回：渲染保存后的 PDF，比较改过行与其它行的最暗像素 */
  const cmp = await ev(`(async()=>{
    const b=window.__PS_SAVED__[0]; if(!b) return {noSave:true};
    const jd=await pdfjsLib.getDocument({data:b.bytes.slice(),disableWorker:true}).promise;
    const pg=await jd.getPage(1);
    const sc=2, vp=pg.getViewport({scale:sc});
    const cv=document.createElement('canvas'); cv.width=Math.round(vp.width); cv.height=Math.round(vp.height);
    const ctx=cv.getContext('2d',{willReadFrequently:true});
    await pg.render({canvasContext:ctx, viewport:vp, intent:'print'}).promise;
    const d=ctx.getImageData(0,0,cv.width,cv.height).data, W=cv.width;
    const darkest=(y0,y1)=>{
      const arr=[];
      for(let y=Math.max(0,y0);y<Math.min(cv.height,y1);y++)
        for(let x=100;x<Math.min(W-40,1000);x++){ const i=(y*W+x)*4; const l=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; if(l<200) arr.push(l); }
      arr.sort((a,b2)=>a-b2);
      const n=Math.max(3,Math.floor(arr.length*0.10));
      return arr.length? Math.round(arr.slice(0,n).reduce((a,v)=>a+v,0)/n) : null;
    };
    /* 第 1 行基线 120pt（改过），第 2 行 155pt（原文） */
    /* 造图时文字画在 canvas 像素 y=120 / 155（含噪点缩放），页面上就是同一位置 */
    const band=yCv=>[Math.round(yCv-18), Math.round(yCv+6)];
    /* 全页统计：确认这一页到底渲染出东西没有 */
    let nDark=0, minL=255;
    for(let i=0;i<d.length;i+=4){ const l=0.299*d[i]+0.587*d[i+1]+0.114*d[i+2]; if(l<200) nDark++; if(l<minL) minL=l; }
    /* 按 PDF 文本项的真实位置取带：改过那行 vs 未改的原文行 */
    const items=(await pg.getTextContent()).items.filter(x=>x.str.trim());
    const pick=kw=>items.find(x=>x.str.includes(kw));
    const bandOf=(it)=>{
      if(!it) return [0,0];
      const y=it.transform[5], h=it.height||it.transform[3]||12;
      return [Math.round((842-(y+h*0.95))*sc), Math.round((842-(y-h*0.25))*sc)];
    };
    const it1=pick('第四条'), it2=pick('第三者'), it3=pick('需经常');
    const edited=it1?darkest(...bandOf(it1)):null;
    const origin=it2?darkest(...bandOf(it2)):null;
    /* 图片里的原文行当对照（扫描底图那一行） */
    const other=darkest(232,250);
    return {edited, origin, other, boxA:it1?bandOf(it1):null,
            found:{a:!!it1, b:!!it2, c:!!it3}};
    window.__RENDER_PNG__=cv.toDataURL('image/png');
    return {bands, edited:darkest(...band(120)), origin:darkest(...band(155)),
            /* 再取第三行（多行段的第二行）当对照 */
            other:darkest(...band(208)),
            w:cv.width, h:cv.height, nDark, minL:Math.round(minL)};
  })()`);
  console.log('COLOR', JSON.stringify(cmp));
  try {
    const png = await ev(`window.__RENDER_PNG__||''`);
    if (png) fs.writeFileSync(path.join(__dirname, 'ui-saved-render.png'), Buffer.from(png.split(',')[1], 'base64'));
    console.log('shot ui-saved-render.png');
  } catch (e) { console.log('render png fail', e.message); }
  const ref = cmp.origin != null ? cmp.origin : cmp.other;
  const gap = (cmp.edited != null && ref != null) ? Math.abs(cmp.edited - ref) : 999;
  console.log(gap <= 12 ? 'PASS 改过行与原文行墨色一致（差 ' + gap + '）' : 'FAIL 墨色差 ' + gap);

  const paraOk = grip.after && grip.before && grip.after[0] >= grip.before[0] + 90 && grip.after[1] >= grip.before[1] + 36;
  console.log(paraOk ? 'PASS 编辑框可自由拉伸' : 'FAIL 拉伸无效');
  console.log(grip.color === 'rgb(0, 0, 0)' ? 'PASS 框内字色=纯黑' : 'FAIL 框内字色 ' + grip.color);

  ws.close(); process.exit(0);
})().catch(e => { console.log('EX', e.message); process.exit(1); });
