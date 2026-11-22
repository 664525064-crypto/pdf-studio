/* 探针15：useObjectStreams / 重复 setFont 对提取的影响 */
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
    async function build(mode){
      const doc=await PDF_().PDFDocument.create();
      const page=doc.addPage([400,300]);
      const font=await ensureFont(doc,'song');
      const P=PDF_();
      // mode A: 一次 setFont；mode B: 每次都 setFont（模拟逐行调用）
      if(mode==='A') page.setFont(font);
      for(let i=0;i<10;i++){
        if(mode==='B') page.setFont(font);
        page.pushOperators(P.beginText(), P.setFontAndSize(page.fontKey,12),
          P.setTextMatrix(1,0,0,1,40,200-i*20), P.setFillingColor(P.rgb(0,0,0)),
          P.showText(font.encodeText('乙路'+i)), P.endText());
      }
      const opts= mode==='A'||mode==='B' ? {useObjectStreams:true} : {};
      return await doc.save(opts);
    }
    async function ext(b){
      const d=await pdfjsLib.getDocument({data:b.slice()}).promise;
      const pg=await d.getPage(1);
      const tc=await pg.getTextContent();
      return tc.items.filter(o=>o.str&&o.str.trim()).map(o=>o.str).slice(0,25).join('|');
    }
    // C = 单次 setFont + 默认保存（已知好的基线）；D = 重复 setFont + 默认保存；E = 单次 + objstm
    async function buildC(rep, objstm){
      const doc=await PDF_().PDFDocument.create();
      const page=doc.addPage([400,300]);
      const font=await ensureFont(doc,'song');
      const P=PDF_();
      if(!rep) page.setFont(font);
      for(let i=0;i<10;i++){
        if(rep) page.setFont(font);
        page.pushOperators(P.beginText(), P.setFontAndSize(page.fontKey,12),
          P.setTextMatrix(1,0,0,1,40,200-i*20), P.setFillingColor(P.rgb(0,0,0)),
          P.showText(font.encodeText('乙路'+i)), P.endText());
      }
      return await doc.save(objstm?{useObjectStreams:true}:{});
    }
    return {
      C_once_default: await ext(await buildC(false,false)),
      D_rep_default:  await ext(await buildC(true,false)),
      E_once_objstm:  await ext(await buildC(false,true)),
    };
  })()`);
  console.log('DBG15', JSON.stringify(r, null, 1));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
