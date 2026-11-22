/* 探针13：loaded doc（PDFDocument.load）下 pushOperators 提取复现 */
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
    const resp=await fetch('app:///test-a.pdf').catch(()=>null);
    return {fetch: resp? resp.status : 'fail'};
  })()`);
  console.log('A13-fetch', JSON.stringify(r));

  // 直接读磁盘不行，改从 ED 当前文档拿？更简单：node 侧把 test-a.pdf base64 注入
  const fs = require('fs');
  const b64 = fs.readFileSync('test-a.pdf').toString('base64');
  const r2 = await ev(`(async()=>{
    const bytes=Uint8Array.from(atob("${b64}"), c=>c.charCodeAt(0));
    const doc=await PDF_().PDFDocument.load(bytes);
    const page=doc.getPage(0);
    const font=await ensureFont(doc,'song');
    // 新建 doc 对照
    const doc2=await PDF_().PDFDocument.create();
    const page2=doc2.addPage([400,300]);
    const font2=await ensureFont(doc2,'song');
    function run(p,f){
      p.drawText('甲路drawText',{x:40,y:200,size:12,font:f});
      const P=PDF_();
      p.setFont(f);
      p.pushOperators(P.beginText(), P.setFontAndSize(p.fontKey,12),
        P.setTextMatrix(1,0,0,1,40,160), P.setFillingColor(P.rgb(0,0,0)),
        P.showText(f.encodeText('乙路pushOps')), P.endText());
    }
    run(page,font); run(page2,font2);
    const b1=await doc.save();
    const b2=await doc2.save();
    async function ext(b){
      const d=await pdfjsLib.getDocument({data:b.slice()}).promise;
      const pg=await d.getPage(1);
      const tc=await pg.getTextContent();
      return tc.items.filter(o=>o.str&&o.str.trim()).map(o=>o.str).slice(0,8);
    }
    // 同时检查 loaded doc 的资源键
    const d1=await PDF_().PDFDocument.load(b1);
    const fonts=d1.getPage(0).node.Resources().lookup(PDF_().PDFName.of('Font'));
    const keys=[]; fonts.entries().forEach(([k,v])=>keys.push(k.asString()));
    return {loaded:await ext(b1), fresh:await ext(b2), keys};
  })()`);
  console.log('DBG13', JSON.stringify(r2, null, 1));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
