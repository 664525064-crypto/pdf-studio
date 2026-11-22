/* 验证差异重写：改「被保险人」行 与 在「保险期间」里插 555555，保存后渲染对比 */
const fs = require('fs');
const path = require('path');
const OUT = 'C:/Users/Administrator/WorkBuddy/2026-11-16-19-18-26/pdf-studio/_test/out';
const b64 = fs.readFileSync(__dirname + '/policy_p1.pdf').toString('base64');

(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params, timeout = 120000) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async (x, t = 120000) => {
    const m = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true }, t);
    if (m.result.exceptionDetails) return 'EXC:' + JSON.stringify(m.result.exceptionDetails).slice(0, 500);
    return m.result.result.value;
  };
  const savePng = (url, f) => { fs.writeFileSync(f, Buffer.from(url.split(',')[1], 'base64')); };

  console.log('boot:', await ev(`(async()=>{ await __PS.testOpenDoc('policy_p1.pdf','${b64}'); await new Promise(r=>setTimeout(r,1500)); await __PS.openEditor(0); await new Promise(r=>setTimeout(r,1800)); return ED.lines.length; })()`, 180000));

  // 截图基线
  const base = await ev(`document.getElementById('edCanvas').toDataURL('image/png')`, 60000);
  if (typeof base === 'string' && base.startsWith('data:')) savePng(base, path.join(__dirname, 'fix_base.png'));

  // A) 被保险人：把公司名改一个字（走真实点行→编辑→回车流程）
  const r1 = await ev(`(async()=>{
    var i=ED.lines.findIndex(function(L){return (L.text||'').indexOf('被保险人：')===0});
    var tl=document.querySelector('.tline[data-i="'+i+'"]'); if(!tl) return {err:'no tline'};
    tl.click();
    var box=null; for(var k=0;k<30 && !(box=document.querySelector('.edin'));k++) await new Promise(r=>setTimeout(r,150));
    if(!box) return {err:'no box'};
    box.focus(); box.textContent=ED.lines[i].text.replace('安润','安泰');
    box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,400));
    var rec=ED.edits[ED.edits.length-1];
    return {i:i, suffix:!!rec.suffix, x:+rec.x.toFixed(1), w:+(rec.w||0).toFixed(1), size:rec.size,
            hscale:rec.hscale, tail:rec.text, full:rec.full};
  })()`, 90000);
  console.log('A rec:', JSON.stringify(r1));

  console.log('A save:', JSON.stringify(await ev(`__PS.testSaveEdits()`, 180000)));
  let files = fs.readdirSync(OUT).map(f => ({ f, t: fs.statSync(path.join(OUT, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  const fileA = files[0].f;
  console.log('A file:', fileA);
  const b64A = fs.readFileSync(path.join(OUT, fileA)).toString('base64');
  console.log('A reopen:', await ev(`(async()=>{ await __PS.testOpenDoc('${fileA}','${b64A}'); await new Promise(r=>setTimeout(r,1200)); await __PS.openEditor(0); await new Promise(r=>setTimeout(r,1500)); return ED.lines.length; })()`, 180000));
  const pngA = await ev(`document.getElementById('edCanvas').toDataURL('image/png')`, 60000);
  if (typeof pngA === 'string' && pngA.startsWith('data:')) savePng(pngA, path.join(__dirname, 'fix_A.png'));

  // B) 保险期间：插入 555555
  await ev(`(async()=>{ await __PS.testOpenDoc('policy_p1.pdf','${b64}'); await new Promise(r=>setTimeout(r,1200)); await __PS.openEditor(0); await new Promise(r=>setTimeout(r,1500)); __PS.testResetEdits(); return 1; })()`, 180000);
  const r2 = await ev(`(async()=>{
    var i=ED.lines.findIndex(function(L){return (L.text||'').indexOf('保险期间：')===0});
    edStartEdit(i);
    var box=null; for(var k=0;k<30 && !(box=document.querySelector('.edin'));k++) await new Promise(r=>setTimeout(r,150));
    if(!box) return {err:'no box'};
    box.focus(); box.textContent=ED.lines[i].text.replace('零时起，','零时起，555555');
    edCommitInline();
    await new Promise(r=>setTimeout(r,300));
    var rec=ED.edits[ED.edits.length-1];
    return {i:i, suffix:!!rec.suffix, x:+rec.x.toFixed(1), w:+(rec.w||0).toFixed(1), size:rec.size,
            hscale:rec.hscale, tail:rec.text.slice(0,24), full:rec.full.slice(0,30)};
  })()`, 90000);
  console.log('B rec:', JSON.stringify(r2));
  console.log('B save:', JSON.stringify(await ev(`__PS.testSaveEdits()`, 180000)));
  files = fs.readdirSync(OUT).map(f => ({ f, t: fs.statSync(path.join(OUT, f)).mtimeMs })).sort((a, b) => b.t - a.t);
  const fileB = files[0].f;
  console.log('B file:', fileB);
  const b64B = fs.readFileSync(path.join(OUT, fileB)).toString('base64');
  console.log('B reopen:', await ev(`(async()=>{ await __PS.testOpenDoc('${fileB}','${b64B}'); await new Promise(r=>setTimeout(r,1200)); await __PS.openEditor(0); await new Promise(r=>setTimeout(r,1500)); return ED.lines.length; })()`, 180000));
  const pngB = await ev(`document.getElementById('edCanvas').toDataURL('image/png')`, 60000);
  if (typeof pngB === 'string' && pngB.startsWith('data:')) savePng(pngB, path.join(__dirname, 'fix_B.png'));

  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
