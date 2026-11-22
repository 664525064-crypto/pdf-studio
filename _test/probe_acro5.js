/* 探针5：拖动+加粗记录 → 保存 → 读回验证 */
const fs=require('fs');
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
    if(ED.inline) edCommitInline();
    __PS.testResetEdits(); ED.news.length=0;
    const li=__PS.editor.lines.findIndex(l=>l.text.indexOf('签单日期')>=0);
    document.querySelector('.tline[data-i="'+li+'"]').click();
    await new Promise(r=>setTimeout(r,150));
    const bx=document.querySelector('.edin');
    $('fmtB').click();
    bx.innerText='签单日期：2026年09月15日 四川省成都市锦江区';
    bx.dispatchEvent(new Event('input',{bubbles:true}));
    if(ED.inline===bx) edCommitInline();
    await new Promise(r=>setTimeout(r,120));
    const rec=ED.edits[ED.edits.length-1];
    rec.mvx=40; rec.mvy=-23;
    const sv=await __PS.testSaveEdits();
    const u8=window.__PS_SAVED__[window.__PS_SAVED__.length-1].bytes;
    let b64=''; { let bin=''; for(let i=0;i<u8.length;i+=8192) bin+=String.fromCharCode.apply(null,u8.subarray(i,i+8192)); b64=btoa(bin); }
    const d=await pdfjsLib.getDocument({data:u8.slice()}).promise; const pg=await d.getPage(1);
    const tc=await pg.getTextContent();
    const items=tc.items.filter(o=>o.str.indexOf('签单日期')>=0).map(o=>({t:o.str.slice(0,10), x:Math.round(o.transform[4]), y:Math.round(o.transform[5])}));
    let trMode=0;
    try{ const ol=pg.getOperatorList(); const OPS=pdfjsLib.OPS;
      for(let k=0;k<ol.fnArray.length;k++) if(ol.fnArray[k]===OPS.setTextRenderingMode) trMode=Math.max(trMode, ol.argsArray[k][0]); }catch(e){}
    return { sv, rec:{x:rec.x, mvx:rec.mvx, bold:rec.bold, size:rec.size, fam:rec.fam}, items, trMode, b64 };
  })()`);
  fs.writeFileSync('save_dbg.pdf', Buffer.from(r.b64,'base64'));
  console.log('SAVE-DBG', JSON.stringify({...r, b64:undefined}));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
