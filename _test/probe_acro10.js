/* 探针10：保存后检查 /Font 资源键 vs Tf 引用名 */
(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params, timeout=60000) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async x => {
    const m = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true });
    if (m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails.exception && m.result.exceptionDetails.exception.description || m.result.exceptionDetails).slice(0, 700));
    return m.result.result.value;
  };

  const expr = `(async()=>{
    const doc=await PDF_().PDFDocument.create();
    const page=doc.addPage([400,300]);
    const font=await ensureFont(doc,'hei');
    page.drawText('甲路drawText',{x:40,y:200,size:12,font});
    const P=PDF_();
    page.pushOperators(P.beginText(), P.setFontAndSize(font.name,12),
      P.setTextMatrix(1,0,0,1,40,160), P.setFillingColor(P.rgb(0,0,0)),
      P.showText(font.encodeText('乙路pushOps')), P.endText());
    const bytes=await doc.save();
    const d2=await PDF_().PDFDocument.load(bytes);
    const pg=d2.getPage(0);
    const fonts=pg.node.Resources().lookup(PDF_().PDFName.of('Font'));
    const entries=[];
    fonts.entries().forEach(([k,v])=>{
      const f=d2.context.lookup(v);
      const bf=f.get(PDF_().PDFName.of('BaseFont'));
      const tu=f.get(PDF_().PDFName.of('ToUnicode'));
      entries.push({key:k.asString(), base:bf?bf.toString():'?', tu: tu?'YES':'MISSING'});
    });
    const csRef=pg.node.Contents();
    let raw;
    const csObj=d2.context.lookup(csRef);
    if(csObj instanceof PDF_().PDFArray){
      let parts=[];
      for(let i=0;i<csObj.size();i++){ const s=d2.context.lookup(csObj.get(i)); parts.push(s.contents||s.getContents()); }
      raw=parts.reduce((acc,p)=>{ const u=new Uint8Array(acc.length+p.length); u.set(acc,0); u.set(p,acc.length); return u; });
    } else { raw=csObj.contents||csObj.getContents(); }
    const ds=new DecompressionStream('deflate');
    const stream=new Blob([raw]).stream().pipeThrough(ds);
    const inflated=new Uint8Array(await new Response(stream).arrayBuffer());
    const txt=new TextDecoder('latin1').decode(inflated);
    const tfs=(txt.match(/\\/[A-Za-z0-9+_-]+ \\d+ Tf/g)||[]);
    const tjHex=(txt.match(/<[0-9A-Fa-f]+>\\s*Tj/g)||[]);
    return {entries, tfs, tjHex, name: font.name};
  })()`;
  const r = await ev(expr);
  console.log('DBG10', JSON.stringify(r, null, 1));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
