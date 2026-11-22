/* 重载页面后复测：探针10 + 探针9 */
(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params, timeout=90000) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async x => {
    const m = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true });
    if (m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails.exception && m.result.exceptionDetails.exception.description || m.result.exceptionDetails).slice(0, 700));
    return m.result.result.value;
  };

  await send('Page.enable');
  await send('Page.reload');
  await new Promise(r => setTimeout(r, 4000));

  const r = await ev(`(async()=>{
    const out={};
    for(const fam of ['hei','song']){
      const doc=await PDF_().PDFDocument.create();
      const page=doc.addPage([400,300]);
      const font=await ensureFont(doc,fam);
      page.drawText('甲路drawText',{x:40,y:200,size:12,font});
      const P=PDF_();
      page.setFont(font);
      page.pushOperators(P.beginText(), P.setFontAndSize(page.fontKey,12),
        P.setTextMatrix(1,0,0,1,40,160), P.setFillingColor(P.rgb(0,0,0)),
        P.showText(font.encodeText('乙路pushOps')), P.endText());
      const bytes=await doc.save();
      const d2=await pdfjsLib.getDocument({data:bytes.slice()}).promise;
      const p2=await d2.getPage(1);
      const tc=await p2.getTextContent();
      out[fam]=tc.items.filter(o=>o.str&&o.str.trim()).map(o=>o.str);
    }
    return out;
  })()`);
  console.log('UNI-DBG-RELOAD', JSON.stringify(r, null, 1));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
