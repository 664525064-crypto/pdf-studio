/* 调试 pdfEraseText 为何没生效 */
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
    const P=PDF_();
    const info={decodePDFRawStream:typeof P.decodePDFRawStream, PDFRawStream:typeof P.PDFRawStream, PDFArray:typeof P.PDFArray};
    const r=await __PS.testOpenDoc(${JSON.stringify(file)},'${b64}');
    await new Promise(r2=>setTimeout(r2,1200));
    const doc=await loadPdf(st.bytes);
    const page=doc.getPages()[0];
    info.rot = page.getRotation? JSON.stringify(page.getRotation()) : 'none';
    const ctx=page.doc.context;
    const src=page.node.get(P.PDFName.of('Contents'));
    const node=src?ctx.lookup(src):null;
    info.contentsType = node? (node.constructor&&node.constructor.name||typeof node) : 'null';
    if(node instanceof P.PDFArray){ info.isArray=true; info.len=node.asArray().length;
      const first=ctx.lookup(node.asArray()[0]); info.firstType=first&&(first.constructor&&first.constructor.name||typeof first);
      info.hasGetUnencoded = first && typeof first.getUnencodedContents==='function';
      if(first){ try{ const u=first.getUnencodedContents(); info.unencLen = u?u.length:null; }catch(e){ info.unencErr=e.message; }
        if(P.decodePDFRawStream){ try{ const d=P.decodePDFRawStream(first).decode(); info.decLen=d.length; info.head=String.fromCharCode.apply(null,d.subarray(0,60)); }catch(e){ info.decErr=e.message; } }
      }
    } else if(node){
      info.hasGetUnencoded = typeof node.getUnencodedContents==='function';
      try{ const u=node.getUnencodedContents(); info.unencLen=u?u.length:null; }catch(e){ info.unencErr=e.message; }
      if(P.decodePDFRawStream){ try{ const d=P.decodePDFRawStream(node).decode(); info.decLen=d.length; info.head=String.fromCharCode.apply(null,d.subarray(0,60)); }catch(e){ info.decErr=e.message; } }
    }
    return info;
  })()`);
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
