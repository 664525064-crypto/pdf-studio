/* 探针4：复现格式条用例，跟踪 blur 链路 */
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
    if (m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails.exception && m.result.exceptionDetails.exception.description || m.result.exceptionDetails).slice(0, 600));
    return m.result.result.value;
  };

  const r = await ev(`(async()=>{
    window.__LOG=[];
    const _ci=edCommitInline, _cp=edCommitPara, _cn=edCommitNew;
    edCommitInline=function(){ window.__LOG.push(['commitInline', this===window?'':String(arguments&&arguments[0]&&arguments[0].className||'')]); return _ci.apply(this,arguments); };
    edCommitPara=function(){ window.__LOG.push(['commitPara']); return _cp.apply(this,arguments); };
    edCommitNew=function(){ window.__LOG.push(['commitNew']); return _cn.apply(this,arguments); };

    if(ED.inline) edCommitInline();
    __PS.testResetEdits();
    await __PS.openEditor(0);
    const E=__PS.editor;
    const i=E.lines.findIndex(l=>l.text.indexOf('签单日期')>=0);
    if(i<0) return {err:'line not found', n:E.lines.length, names:E.lines.slice(0,5).map(l=>l.text.slice(0,10))};
    document.querySelector('.tline[data-i="'+i+'"]').click();
    await new Promise(r=>setTimeout(r,150));
    const box=document.querySelector('.edin'); if(!box) return {err:'no box'};
    const f0={ active:document.activeElement===box, cls:box.className, inline:ED.inline===box };
    box.dataset.fsize=10.5;
    $('fmtB').click(); $('fmtI').click();
    $('edFmt').querySelector('[data-fa="right"]').click();
    $('fmtLh').value='1.8'; $('fmtLh').onchange();
    const f1={ active:document.activeElement===box, fmtFocus:ED.fmtFocus };
    box.innerText='签单日期：2026年09月15日';
    box.dispatchEvent(new Event('input',{bubbles:true}));
    const bl=[];
    box.addEventListener('blur', ()=>bl.push('blur-fired'), true);
    box.blur();
    await new Promise(r=>setTimeout(r,200));
    const rec=ED.edits[ED.edits.length-1]||null;
    return { f0, f1, bl, log:window.__LOG, n:ED.edits.length,
             bold:rec&&rec.bold, italic:rec&&rec.italic, align:rec&&rec.align,
             lead:rec&&rec.lead, multi:rec&&rec.multi, text:rec&&rec.text&&String(rec.text).slice(0,14) };
  })()`);
  console.log('FMT-DBG', JSON.stringify(r));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
