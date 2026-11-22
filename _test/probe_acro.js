/* 探针：调试插入文本与格式条提交时序 */
const fs = require('fs');

(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params, timeout=30000) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async x => {
    const m = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true });
    if (m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails.exception && m.result.exceptionDetails.exception.description || m.result.exceptionDetails).slice(0, 500));
    return m.result.result.value;
  };

  const A = fs.readFileSync('test-a.pdf').toString('base64');
  await ev(`(async()=>{ window.__E2E__=1; await __PS.testOpenDoc('t.pdf','${A}'); __PS.selectTool('edittext'); await __PS.openEditor(0); })()`);

  const r1 = await ev(`(async()=>{
    __PS.testResetEdits(); ED.news.length=0;
    $('edAddText').click();
    const layer=$('edLayer'), rc=$('edStage').getBoundingClientRect();
    const x=rc.left+120, y=rc.top+60;
    layer.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,clientX:x,clientY:y}));
    document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,clientX:x,clientY:y}));
    await new Promise(r=>setTimeout(r,150));
    const box=[...document.querySelectorAll('.edin.newbox')].pop();
    if(!box) return {st:'no box', pend:ED.pendNew, inline:!!ED.inline, drag:!!ED.drag};
    box.innerText=' inserted text 备注 ';
    box.dispatchEvent(new Event('input',{bubbles:true}));
    const events=[];
    document.addEventListener('blur', e=>events.push('blur'), true);
    const before={ active:document.activeElement===box, inline:ED.inline===box };
    box.blur();
    await new Promise(r=>setTimeout(r,150));
    return { st:'ok', before, events, afterInline:ED.inline?ED.inline.className:null, n:ED.news.length,
             rec:ED.news[0]&&ED.news[0].text, side:$('edList').children.length };
  })()`);
  console.log('NEWBOX', JSON.stringify(r1));

  const r2 = await ev(`(async()=>{
    ED.edits.length=0; ED.news.length=0;
    const i=__PS.editor.lines.findIndex(l=>l.text.indexOf('签单日期')>=0);
    document.querySelector('.tline[data-i="'+i+'"]').click();
    await new Promise(r=>setTimeout(r,150));
    const box=document.querySelector('.edin'); if(!box) return {st:'no box'};
    box.dataset.fsize=10.5;
    $('fmtB').click(); $('fmtI').click();
    $('edFmt').querySelector('[data-fa="right"]').click();
    $('fmtLh').value='1.8'; $('fmtLh').onchange();
    box.innerText='签单日期：2026年09月15日';
    box.dispatchEvent(new Event('input',{bubbles:true}));
    box.blur();
    await new Promise(r=>setTimeout(r,150));
    const rec=ED.edits[ED.edits.length-1]||null;
    return { st:'ok', n:ED.edits.length, bold:rec&&rec.bold, italic:rec&&rec.italic,
             align:rec&&rec.align, lead:rec&&rec.lead, multi:rec&&rec.multi, text:rec&&rec.text&&rec.text.slice(0,12) };
  })()`);
  console.log('FMT', JSON.stringify(r2));

  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
