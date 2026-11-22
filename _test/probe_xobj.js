/* 诊断：金额行文字在顶层内容流还是 Form XObject 里 */
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
    if(!L) return {err:'no line'};
    const h=Math.max(4, L.h||L.size||9);
    const rect={ x:L.x-1.5, x2:L.x2+1.5, y0:L.y-h*0.45, y1:L.y+L.size*0.95+h*0.45 };
    const doc=await loadPdf(st.bytes);
    const pg=doc.getPages()[0];
    const P=PDF_();
    const ctx=pg.doc.context;
    const src=pg.node.get(P.PDFName.of('Contents'));
    const node=src?ctx.lookup(src):null;
    const list2=[];
    if(node instanceof P.PDFArray) node.asArray().forEach(r=>list2.push(ctx.lookup(r)));
    else if(node) list2.push(node);
    let topBytes=null;
    try{ const parts=list2.map(st=>P.decodePDFRawStream(st).decode()); topBytes=parts; }catch(e){ topBytes=null; }
    const topAll = topBytes ? topBytes.join('\\n') : null;
    // 直接用字符串形式跑 edCleanContent 逻辑不方便（它吃 bytes），转 Uint8Array
    const enc=new TextEncoder();
    const r1 = topAll ? edCleanContent(enc.encode(topAll), [rect]) : null;
    // 枚举 XObject
    const xos=[];
    try{
      const res2=pg.node.get(P.PDFName.of('Resources'));
      const rd=res2?ctx.lookup(res2):null;
      const xo=rd&&rd.get(P.PDFName.of('XObject'));
      const xdict=xo?ctx.lookup(xo):null;
      if(xdict&&xdict.entries){
        for(const [nm,v] of xdict.entries()){
          const o=ctx.lookup(v);
          const sub=o&&o.get?String(o.get(P.PDFName.of('Subtype'))):'?';
          xos.push({name:nm.asString?nm.asString():String(nm), sub});
          if(String(sub)==='/Form' && o.contents){
            let fb=null; try{ fb=P.decodePDFRawStream(o).decode(); }catch(e){}
            if(fb){
              const rr=edCleanContent(fb, [rect]);
              xos[xos.length-1].formHits=rr?rr.n:0;
              xos[xos.length-1].hasTj=/Tj|TJ/.test(String(fb.slice(0,20000)));
            }
          }
        }
      }
    }catch(e){ xos.push({err:String(e).slice(0,120)}); }
    return { line:{t:L.text, x:+L.x.toFixed(1), y:+L.y.toFixed(1), x2:+L.x2.toFixed(1), size:+L.size.toFixed(1)},
      rect, topStreams: topBytes?topBytes.length:0,
      topDrop: r1?r1.n:'null', topHasTj: topAll?/Tj|TJ/.test(topAll):null,
      topTopjCount: topAll?(topAll.match(/Tj|TJ/g)||[]).length:0,
      xos };
  })()`;

  const raw = await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
  if(raw.result && raw.result.exceptionDetails) console.log('EXC:', JSON.stringify(raw.result.exceptionDetails).slice(0,800));
  console.log('VAL:', JSON.stringify(raw.result && raw.result.result && raw.result.result.value, null, 1));
  ws.close(); process.exit(0);
})().catch(e=>{ console.error('FATAL', e.message); process.exit(2); });
