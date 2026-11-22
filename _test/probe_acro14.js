/* 探针14：真实保存后 y≈653 附近条目 + 字体资源键全景 */
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

  const r = await ev(`(async()=>{
    window.__PS_SAVED__.length=0;
    await __PS.testSaveEdits();
    const u8=window.__PS_SAVED__[0].bytes;
    const d=await pdfjsLib.getDocument({data:u8.slice()}).promise;
    const pg=await d.getPage(1);
    const tc=await pg.getTextContent();
    const near=tc.items.filter(o=>o.str && o.transform[5]>620 && o.transform[5]<700)
      .map(o=>({s:o.str.slice(0,12), x:Math.round(o.transform[4]), y:Math.round(o.transform[5])}));
    const far=tc.items.filter(o=>o.str && o.transform[4]>100 && o.transform[4]<260 && o.transform[5]<620)
      .map(o=>({s:o.str.slice(0,10), x:Math.round(o.transform[4]), y:Math.round(o.transform[5])})).slice(0,6);
    const d2=await PDF_().PDFDocument.load(u8);
    const fonts=d2.getPage(0).node.Resources().lookup(PDF_().PDFName.of('Font'));
    const keys=[]; fonts.entries().forEach(([k,v])=>{
      const f=d2.context.lookup(v);
      keys.push(k.asString()+' base:'+(f.get(PDF_().PDFName.of('BaseFont'))||'').toString());
    });
    const inserted=tc.items.some(o=>o.str.indexOf('inserted text')>=0);
    const moved=tc.items.some(o=>o.str.indexOf('签单日期')>=0 && o.transform[4]>100);
    return {near, far, keys, inserted, moved};
  })()`);
  console.log('DBG14', JSON.stringify(r, null, 1));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
