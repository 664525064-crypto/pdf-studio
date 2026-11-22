/* 诊断2：深挖 /Im0 XObject，确认文字在里面并测 edCleanContent 命中 */
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
    await __PS.testResetEdits();
    await __PS.testOpenDoc('diag.pdf','${b64}');
    await new Promise(r=>setTimeout(r,1500));
    await __PS.openEditor(0);
    await new Promise(r=>setTimeout(r,1500));
    const L=ED.lines.find(l=>(l.text||'').indexOf('总保险金额')===0);
    const h=Math.max(4, L.h||L.size||9);
    const rect={ x:L.x-1.5, x2:L.x2+1.5, y0:L.y-h*0.45, y1:L.y+L.size*0.95+h*0.45 };
    const doc=await loadPdf(st.bytes);
    const pg=doc.getPages()[0];
    const P=PDF_();
    const ctx=pg.doc.context;
    const out={};
    const reso=pg.node.get(P.PDFName.of('Resources'));
    const rd=reso?ctx.lookup(reso):null;
    const xo=rd&&rd.get(P.PDFName.of('XObject'));
    const xdict=xo?ctx.lookup(xo):null;
    out.xdictType=xdict?xdict.constructor.name:null;
    if(xdict&&xdict.entries){
      for(const [nm,ref] of xdict.entries()){
        const o=ctx.lookup(ref);
        const info={ name:nm.asString?nm.asString():String(nm), cls:o?o.constructor.name:null };
        try{
          const st=o.get(P.PDFName.of('Subtype'));
          info.sub=st?(st.asString?st.asString():st.toString()):null;
        }catch(e){ info.subErr=String(e).slice(0,80); }
        if(o.dict) info.isStream=true;
        let fb=null;
        try{ fb=P.decodePDFRawStream(o).decode(); info.decoded=fb.length; }
        catch(e){ info.decErr=String(e).slice(0,80); }
        if(fb){
          info.tjCount=(String(fb).match(/Tj|TJ/g)||[]).length;
          const rr=edCleanContent(fb, [rect]);
          info.hits=rr?rr.n:0;
          info.hasBDC=/BDC/.test(String(fb));
          info.head=String(fb).slice(0,150).replace(/[^\\x20-\\x7e]/g,'.');
        }
        (out.xos=out.xos||[]).push(info);
      }
    }
    return out;
  })()`;

  const raw = await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
  if(raw.result && raw.result.exceptionDetails) console.log('EXC:', JSON.stringify(raw.result.exceptionDetails).slice(0,800));
  console.log('VAL:', JSON.stringify(raw.result && raw.result.result && raw.result.result.value, null, 1));
  ws.close(); process.exit(0);
})().catch(e=>{ console.error('FATAL', e.message); process.exit(2); });
