/* 验证：①改字颜色 = 原文黑色 ②编辑框可自由拉伸（右下角拖动） */
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

const GEN = `(async()=>{
  /* 造一页"扫描件"：黑字 + 轻微噪点（模拟真实扫描件的灰度），无文字层 */
  const W=1190, H=1684;
  const cv=document.createElement('canvas'); cv.width=W; cv.height=H;
  const g=cv.getContext('2d');
  g.fillStyle='#fff'; g.fillRect(0,0,W,H);
  g.fillStyle='#0d0d0d';
  const px=pt=>pt*W/595;
  const txt=(s,x,y,size,fam)=>{ g.font=size+'px '+fam; g.fillText(s, px(x), px(y)); };
  txt('第三条 在移动、灌装转运期间，由于下列原因和情况造成的保险标的的损失和费用，保险', 56, 120, px(12), '"SimSun"');
  txt('人不负责赔偿：', 56, 140, px(12), '"SimSun"');
  txt('（一）盗窃、抢劫、抢夺；', 56, 170, px(12), '"SimSun"');
  txt('（二）被保险人、承运人或驾驶员的故意行为或重大过失行为；', 56, 200, px(12), '"SimSun"');
  txt('第四条 下列损失和费用，保险人也不负责赔偿：', 56, 230, px(12), '"SimSun"');
  txt('（一）保险标的造成的第三者损失；', 56, 260, px(12), '"SimSun"');
  /* 叠加极轻的扫描噪点：让黑字边缘出现灰阶，正是"改完变浅"的成因 */
  const id=g.getImageData(0,0,W,H), d=id.data;
  for(let i=0;i<d.length;i+=4){
    if(d[i]>250 && Math.random()<0.06){ const v=235+Math.random()*18; d[i]=d[i+1]=d[i+2]=v; }
  }
  g.putImageData(id,0,0);
  const blob=await new Promise(r=>cv.toBlob(r,'image/png'));
  const buf=new Uint8Array(await blob.arrayBuffer());
  const PL=PDFLib_;
  const doc=await PL.PDFDocument.create();
  const img=await doc.embedPng(buf);
  const p=doc.addPage([595,842]);
  p.drawImage(img,{x:0,y:0,width:595,height:842});
  const bytes=await doc.save({useObjectStreams:true});
  let bin=''; const CH=0x8000;
  for(let i=0;i<bytes.length;i+=CH) bin+=String.fromCharCode.apply(null, bytes.subarray(i,i+CH));
  await __PS.testOpenDoc('scan-ink.pdf', btoa(bin));
  await __PS.openEditor(0);
  for(let k=0;k<60;k++){ await new Promise(r=>setTimeout(r,700));
    const E=__PS.editor; if(E && E.ocrDone && E.ocrDone[E.page] && E.lines && E.lines.length) break; }
  const E=__PS.editor;
  const lum=h=>{ const m=h.match(/^#(..)(..)(..)$/); return m?Math.round(0.299*parseInt(m[1],16)+0.587*parseInt(m[2],16)+0.114*parseInt(m[3],16)):-1; };
  return E.lines.filter(l=>l.text&&l.text.trim()).map(l=>({ t:l.text.slice(0,12), size:+l.size.toFixed(1), ink:l.ink, lum:lum(l.ink||'') }));
})()`;

(async () => {
  const { ws, ev } = await conn();
  const rows = await ev(GEN);
  console.log('=== 扫描件每行墨色 ===');
  for (const r of rows) console.log(JSON.stringify(r));
  const bad = rows.filter(r => r.lum > 40);
  console.log(bad.length ? 'FAIL 偏浅行: ' + JSON.stringify(bad) : 'PASS 全部识别为黑');

  /* 单行改字 → 看记录里的颜色 */
  const single = await ev(`(async()=>{
    const E=__PS.editor;
    /* 必须挑"自己一段"的行：多行段点开走的是整段框 */
    const pi=(E.paras||[]).findIndex(g=>g.length===1);
    const i=(pi>=0)? E.paras[pi][0] : E.lines.findIndex(l=>l.text&&l.text.trim());
    document.querySelector('.tline[data-i="'+i+'"]').click();
    await new Promise(r=>setTimeout(r,250));
    const d=document.querySelector('.edin');
    if(!d) return {noBox:true};
    const before={color:d.style.color, w:Math.round(d.getBoundingClientRect().width), h:Math.round(d.getBoundingClientRect().height)};
    /* 模拟拖右下角 +120 × +60 */
    const r0=d.getBoundingClientRect();
    const X=Math.round(r0.right-6), Y=Math.round(r0.bottom-6);
    const mk=(type,cx,cy)=>new MouseEvent(type,{bubbles:true,cancelable:true,clientX:cx,clientY:cy,view:window});
    d.dispatchEvent(mk('mousedown',X,Y));
    document.dispatchEvent(mk('mousemove',X+120,Y+60));
    document.dispatchEvent(mk('mouseup',X+120,Y+60));
    await new Promise(r=>setTimeout(r,120));
    const r1=d.getBoundingClientRect();
    const after={w:Math.round(r1.width), h:Math.round(r1.height), flagged:d.dataset.manSize||''};
    d.innerText=d.innerText.slice(0,-2)+'（改）';
    let err='';
    try{ edCommitInline(); }catch(e){ err=e.message||String(e); }
    await new Promise(r=>setTimeout(r,300));
    /* 这行被拉宽后文字写不下，会自动转成整段记录——两种都认，颜色必须一样 */
    const rec=(__PS.editor.edits||[]).slice(-1)[0];
    return {before, after, err, nEdits:(__PS.editor.edits||[]).length,
      inlineLeft:!!__PS.editor.inline, recColor:rec&&rec.color, recText:rec&&rec.text.slice(0,14),
      all:(__PS.editor.edits||[]).map(e=>({m:!!e.multi,c:e.color,t:(e.text||'').slice(0,10)}))};
  })()`);
  console.log('=== 单行框拉伸 + 提交颜色 ===');
  console.log(JSON.stringify(single));
  const grew = single.after && single.before && (single.after.w > single.before.w + 80) && (single.after.h > single.before.h + 40);
  console.log(grew ? 'PASS 单行框可拉伸' : 'FAIL 单行框没拉动');
  console.log(single.recColor === '#000000' ? 'PASS 写入颜色=纯黑' : 'FAIL 写入颜色 ' + single.recColor);

  /* 整段框：拉伸后打字不能被 fit 拉回 */
  const para = await ev(`(async()=>{
    const E=__PS.editor;
    const pi=(E.paras||[]).findIndex(g=>g.length>=2);
    if(pi<0) return {none:true};
    const at=E.paras[pi];
    document.querySelector('.tline[data-i="'+at[0]+'"]').click();
    await new Promise(r=>setTimeout(r,300));
    const d=document.querySelector('.edin.para');
    if(!d) return {noBox:true};
    const r0=d.getBoundingClientRect();
    const X=Math.round(r0.right-6), Y=Math.round(r0.bottom-6);
    const mk=(type,cx,cy)=>new MouseEvent(type,{bubbles:true,cancelable:true,clientX:cx,clientY:cy,view:window});
    d.dispatchEvent(mk('mousedown',X,Y));
    document.dispatchEvent(mk('mousemove',X+150,Y+80));
    document.dispatchEvent(mk('mouseup',X+150,Y+80));
    await new Promise(r=>setTimeout(r,150));
    const r1=d.getBoundingClientRect();
    /* 继续打字：fit 不应把尺寸改回去 */
    d.focus();
    document.execCommand('insertText',false,'追加文字测试');
    await new Promise(r=>setTimeout(r,300));
    const r2=d.getBoundingClientRect();
    const out={w0:Math.round(r0.width), h0:Math.round(r0.height),
      w1:Math.round(r1.width), h1:Math.round(r1.height),
      w2:Math.round(r2.width), h2:Math.round(r2.height), flag:d.dataset.manSize||''};
    return out;
  })()`);
  console.log('=== 整段框拉伸后打字 ===');
  console.log(JSON.stringify(para));
  const pOk = para.w1 > para.w0 + 100 && Math.abs(para.w2 - para.w1) < 6;
  console.log(pOk ? 'PASS 整段框拉伸后保持尺寸' : 'FAIL 整段框尺寸被改回');

  const shot = await ev(`window.__PDFSTUDIO_BRIDGE__.shot()`);
  fs.writeFileSync(path.join(__dirname, 'ui-ink-stretch.png'), Buffer.from(shot, 'base64'));
  console.log('shot ui-ink-stretch.png');
  ws.close(); process.exit(0);
})().catch(e => { console.log('EX', e.message); process.exit(1); });
