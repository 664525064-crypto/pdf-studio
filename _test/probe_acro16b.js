/* 探针16b：分步定位 Failed to fetch */
(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params, timeout=120000) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async x => {
    const m = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true });
    if (m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails.exception && m.result.exceptionDetails.exception.description || m.result.exceptionDetails).slice(0, 700));
    return m.result.result.value;
  };

  const steps = await ev(`(async()=>{
    const out={};
    try{ window.__PS_SAVED__.length=0; out.s1='cleared'; }catch(e){ out.s1='ERR:'+e.message; }
    try{ const b=await __PS.testSaveEdits(); out.s2='saved len='+b.len+' edits='+b.edits; }catch(e){ out.s2='ERR:'+e.message; }
    try{ out.s3='savedN='+window.__PS_SAVED__.length; }catch(e){ out.s3='ERR:'+e.message; }
    try{
      const u8=window.__PS_SAVED__[0].bytes;
      const d2=await PDF_().PDFDocument.load(u8);
      const fonts=d2.getPage(0).node.Resources().lookup(PDF_().PDFName.of('Font'));
      const keys=[];
      fonts.entries().forEach(([k,v])=>{
        const f=d2.context.lookup(v);
        const tu=f.get(PDF_().PDFName.of('ToUnicode'));
        keys.push({key:k.asString(), base:(f.get(PDF_().PDFName.of('BaseFont'))||'').toString(), tu:tu?'YES':'MISSING'});
      });
      out.s4=keys;
    }catch(e){ out.s4='ERR:'+e.message; }
    try{
      const u8=window.__PS_SAVED__[0].bytes;
      const d=await pdfjsLib.getDocument({data:u8.slice()}).promise;
      const pg=await d.getPage(1);
      const tc=await pg.getTextContent();
      const moved=tc.items.some(o=>o.str.indexOf('签单日期')>=0 && o.transform[4]>100);
      const raws=tc.items.filter(o=>/^[\u0000-\u001f]+$/.test(o.str)).length;
      out.s5={moved, raws, total:tc.items.length};
    }catch(e){ out.s5='ERR:'+e.message; }
    return out;
  })()`);
  console.log('DBG16b', JSON.stringify(steps, null, 1));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
