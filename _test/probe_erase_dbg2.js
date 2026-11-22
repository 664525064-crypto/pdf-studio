/* 直接调 edCleanContent 验证 drop 计数与 rect 命中 */
const fs = require('fs');
const file = process.argv[2] || 'policy_p1.pdf';
const b64 = fs.readFileSync(__dirname + '/' + file).toString('base64');
(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const tab = list.find(t => t.type === 'page');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (m, p, t = 120000) => new Promise((res, rej) => { const id = ++seq; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p || {} })); setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + m)); } }, t); });
  const ev = async (x, t = 120000) => {
    const m = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true }, t);
    if (m.result.exceptionDetails) return 'EXC:' + JSON.stringify(m.result.exceptionDetails).slice(0, 1200);
    return m.result.result.value;
  };
  const out = await ev(`(async()=>{
    await __PS.testOpenDoc(${JSON.stringify(file)},'${b64}');
    await new Promise(r=>setTimeout(r,1200));
    const doc=await loadPdf(st.bytes);
    const page=doc.getPages()[0];
    const P=PDF_();
    const ctx=page.doc.context;
    const src=page.node.get(P.PDFName.of('Contents'));
    const node=src?ctx.lookup(src):null;
    const by=P.decodePDFRawStream(node).decode();
    /* rect：总保险金额 一行，x 130~330，y 468~478 */
    const rects=[{x:130,x2:330,y0:468,y1:478}];
    const res=edCleanContent(by, rects);
    if(!res) return {n:0};
    /* 数一下删掉后流里还有没有旧值字样：内容流是 CJK 编码不好直接看，
       但 ASCII 数字串 (¥3,680,100.00 可能以字面量出现 */
    const after=edBinStr(res.bytes);
    return {n:res.n, lenBefore:by.length, lenAfter:res.bytes.length,
      hasOldLit: after.indexOf('3,680')>=0 || /3\x2c680/.test(after)};
  })()`);
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
