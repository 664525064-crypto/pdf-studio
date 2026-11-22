/* 探针2：blur 提交链路细节 */
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
    __PS.testResetEdits(); ED.news.length=0; ED.edits.length=0;
    ED.pendNew='text';
    const rc=$('edStage').getBoundingClientRect();
    edNewTextBox(rc.left+120, rc.top+60);
    const box=document.querySelector('.edin.newbox');
    if(!box) return {st:'no box'};
    box.innerText=' inserted text 备注 ';
    const hasOnblur=typeof box.onblur==='function';
    let err=null;
    try{ box.blur(); }catch(e){ err=String(e); }
    await new Promise(r=>setTimeout(r,150));
    const s1={ cls:ED.inline?ED.inline.className:null, isBox:ED.inline===box, n:ED.news.length };
    let err2=null;
    try{ if(ED.inline&&ED.inline.classList&&ED.inline.classList.contains('newbox')) edCommitNew(ED.inline); else if(ED.inline) edCommitInline(); }catch(e){ err2=String(e&&e.stack||e).slice(0,300); }
    await new Promise(r=>setTimeout(r,150));
    return { st:'ok', hasOnblur, err, s1, err2, n2:ED.news.length, inline2:ED.inline?ED.inline.className:null };
  })()`);
  console.log('BLUR-DBG', JSON.stringify(r));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
