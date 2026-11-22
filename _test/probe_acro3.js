/* 探针3：记录 edCommitNew / edNewTextBox 的实际调用 */
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
    const _cn=edCommitNew, _nt=edNewTextBox, _ci=edCommitInline;
    edCommitNew=function(d){ window.__LOG.push(['commitNew', d&&d.innerText&&d.innerText.slice(0,20), d&&d.dataset.nwId]); try{ return _cn.apply(this,arguments); }catch(e){ window.__LOG.push(['commitNew-ERR',String(e)]); throw e; } };
    edNewTextBox=function(){ window.__LOG.push(['newTextBox', JSON.stringify([...arguments])]); return _nt.apply(this,arguments); };
    edCommitInline=function(){ window.__LOG.push(['commitInline']); return _ci.apply(this,arguments); };

    ED.pendNew='text';
    const rc=$('edStage').getBoundingClientRect();
    edNewTextBox(rc.left+120, rc.top+60);
    const box=document.querySelector('.edin.newbox');
    box.innerText=' inserted text 备注 ';
    const events=[];
    document.addEventListener('blur', e=>events.push('blur:'+e.target.className), true);
    document.addEventListener('focusout', e=>events.push('focusout:'+e.target.className), true);
    const ae0=document.activeElement===box;
    box.blur();
    const ae1=document.activeElement && document.activeElement.className;
    await new Promise(r=>setTimeout(r,250));
    return { ae0, ae1, events, fired:typeof box.onblur, log:window.__LOG, n:ED.news.length,
             inline:ED.inline?ED.inline.className:null, pend:ED.pendNew };
  })()`);
  console.log('CALLS', JSON.stringify(r));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
