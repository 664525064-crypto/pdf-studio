/* 探针6：直接测 drawStyledText / pushOperators 是否生效 */
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
    if (m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails.exception && m.result.exceptionDetails.exception.description || m.result.exceptionDetails).slice(0, 700));
    return m.result.result.value;
  };

  const r = await ev(`(async()=>{
    const doc=await loadPdf(st.bytes);
    const pg=doc.getPages()[0];
    const font=await ensureFont(doc,'song');
    const P=PDF_();
    const checks={ pushOp:typeof pg.pushOperators, beginText:typeof P.beginText, setFontAndSize:typeof P.setFontAndSize,
                   setTextMatrix:typeof P.setTextMatrix, setFillingColor:typeof P.setFillingColor,
                   setStrokingColor:typeof P.setStrokingColor, setLineWidth:typeof P.setLineWidth,
                   setTextRenderingMode:typeof P.setTextRenderingMode, showText:typeof P.showText, endText:typeof P.endText,
                   trMode: P.TextRenderingMode ? P.TextRenderingMode.FillAndOutline : 'no-enum',
                   fontName: font && font.name ? String(font.name) : String(font && font.name),
                   enc: typeof (font && font.encodeText) };
    let err=null;
    try{
      pg.pushOperators(P.beginText(), P.setFontAndSize(font.name, 11),
        P.setTextMatrix(1,0,0,1,72,400), P.setFillingColor(P.rgb(0,0,0)),
        P.setStrokingColor(P.rgb(0,0,0)), P.setLineWidth(0.4),
        P.setTextRenderingMode(P.TextRenderingMode.FillAndOutline),
        P.showText(font.encodeText('ACROTEST')), P.endText());
    }catch(e){ err=String(e&&e.stack||e).slice(0,400); }
    const bytes=await doc.save();
    const d2=await pdfjsLib.getDocument({data:bytes.slice()}).promise;
    const p2=await d2.getPage(1);
    let trMode=0, found=false;
    try{
      const ol=p2.getOperatorList(); const OPS=pdfjsLib.OPS;
      for(let k=0;k<ol.fnArray.length;k++){
        if(ol.fnArray[k]===OPS.setTextRenderingMode) trMode=Math.max(trMode, ol.argsArray[k][0]);
        if(ol.fnArray[k]===OPS.showText){ const a=ol.argsArray[k][0]; if(String(a).indexOf('ACROTEST')>=0) found=true; }
      }
    }catch(e){}
    let b64=''; try{ let bin=''; for(let i=0;i<bytes.length;i+=8192) bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+8192)); b64=btoa(bin); }catch(e){}
    return { checks, err, trMode, found, size:bytes.length, b64 };
  })()`);
  fs.writeFileSync('ops_dbg.pdf', Buffer.from(r.b64,'base64'));
  console.log('OPS-DBG', JSON.stringify({...r, b64:undefined}));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
