/* 诊断3：顶层内容流内容 + pdf.js operator list 对照 */
const fs = require('fs');
const CDP = process.env.CDP_PORT || 9234;
const FILE = process.env.PROBE_FILE || 'policy_p1.pdf';

(async()=>{
  const b64 = fs.readFileSync(FILE).toString('base64');
  const list = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
  const page = list.find(t=>t.type==='page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id=0; const pend=new Map();
  ws.onmessage = m=>{ const d=JSON.parse(m.data); if(d.id&&pend.has(d.id)){ pend.get(d.id)(d); pend.delete(d.id); } };
  await new Promise((res,rej)=>{ ws.onopen=res; ws.onerror=rej; });
  const send=(method,params)=>new Promise((res)=>{ const i=++id; pend.set(i,res); ws.send(JSON.stringify({id:i,method,params})); });

  const expr = `(async()=>{
    const out={};
    // pdf.js 视角
    const pj=st.jsDoc;
    const p1=await pj.getPage(1);
    const tc=await p1.getTextContent();
    out.pdfjsChars=tc.items.reduce((a,it)=>a+(it.str?it.str.length:0),0);
    out.amountItem=tc.items.filter(it=>(it.str||'').indexOf('总保险金额')>=0).map(it=>({str:it.str.slice(0,30),x:+it.transform[4].toFixed(1),y:+it.transform[5].toFixed(1)}));
    const ol=await p1.getOperatorList();
    out.opCount=ol.fnArray.length;
    const OPS=pdfjsLib.OPS;
    out.showText=(ol.fnArray.filter(f=>f===OPS.showText||f===OPS.showSpacedText).length);
    out.forms=ol.fnArray.filter(f=>f===OPS.paintFormXObjectBegin).length;
    out.images=ol.fnArray.filter(f=>f===OPS.paintImageXObject).length;
    // pdf-lib 视角：顶层流
    const doc=await loadPdf(st.bytes);
    const pg=doc.getPages()[0];
    const P=PDF_();
    const ctx=pg.doc.context;
    const src=pg.node.get(P.PDFName.of('Contents'));
    const node=src?ctx.lookup(src):null;
    let by=null;
    try{ by=P.decodePDFRawStream(node).decode(); }catch(e){ out.decErr=String(e).slice(0,100); }
    if(by){
      const s=String(by);
      out.topLen=by.length;
      out.head=s.slice(0,400).replace(/[^\\x20-\\x7e]/g,'.');
      out.ops={};
      for(const m of s.match(/\\b(Tj|TJ|BT|ET|Do|BDC|Emc|Tm|Td|Tf|cm|q|Q)\\b/g)||[]) out.ops[m]=(out.ops[m]||0)+1;
    }
    // 页面对象原始字典
    const dictStr = pg.node.toString? pg.node.toString().slice(0,600):'';
    out.pageDict=dictStr;
    return out;
  })()`;

  const raw = await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
  if(raw.result && raw.result.exceptionDetails) console.log('EXC:', JSON.stringify(raw.result.exceptionDetails).slice(0,900));
  console.log('VAL:', JSON.stringify(raw.result && raw.result.result && raw.result.result.value, null, 1));
  ws.close(); process.exit(0);
})().catch(e=>{ console.error('FATAL', e.message); process.exit(2); });
