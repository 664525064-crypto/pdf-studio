/* 探针12：带 await 的保存读回检查（trMode + moved 实况） */
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
    if(!window.__PS_SAVED__) return {err:'no __PS_SAVED__'};
    window.__PS_SAVED__.length=0;
    const edits=ED.edits.map(e=>({t:e.text&&e.text.slice(0,8),bold:!!e.bold,mvx:e.mvx||0,mvy:e.mvy||0,x:e.x,page:e.page,ocr:!!e.ocr}));
    const news=ED.news.map(n=>({t:n.text&&n.text.slice(0,8),page:n.page}));
    await __PS.testSaveEdits();
    const u8=window.__PS_SAVED__[0].bytes;
    const d=await pdfjsLib.getDocument({data:u8.slice()}).promise;
    const pg=await d.getPage(1);
    const tc=await pg.getTextContent();
    const qd=tc.items.filter(o=>o.str.indexOf('签单日期')>=0).map(o=>({s:o.str.slice(0,10),x:Math.round(o.transform[4]),y:Math.round(o.transform[5])}));
    const ol=await pg.getOperatorList();
    const OPS=pdfjsLib.OPS;
    let trMode=0, trCount=0;
    for(let k=0;k<ol.fnArray.length;k++){
      if(ol.fnArray[k]===OPS.setTextRenderingMode){ trCount++; trMode=Math.max(trMode, ol.argsArray[k][0]); }
    }
    const inserted=tc.items.some(o=>o.str.indexOf('inserted text')>=0);
    return {edits, news, qd, trMode, trCount, inserted};
  })()`);
  console.log('DBG12', JSON.stringify(r, null, 1));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
