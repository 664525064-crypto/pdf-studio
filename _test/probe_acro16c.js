/* 探针16c：Tr 块 Tf 引用键 + 各字典 ToUnicode 映射内容 */
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

  const steps = await ev(`(async()=>{
    const out={};
    const u8=window.__PS_SAVED__[0].bytes;
    const d2=await PDF_().PDFDocument.load(u8);
    const pgNode=d2.getPage(0).node;
    const fonts=pgNode.Resources().lookup(PDF_().PDFName.of('Font'));
    const cmapOf={};
    fonts.entries().forEach(([k,v])=>{
      const f=d2.context.lookup(v);
      const tu=f.get(PDF_().PDFName.of('ToUnicode'));
      if(!tu){ cmapOf[k.asString()]='MISSING'; return; }
      const s=d2.context.lookup(tu);
      const raw=s.contents||s.getContents();
      // ToUnicode 通常是 FlateDecode，试解压
      cmapOf[k.asString()]='stream@'+(tu.asString?tu.asString():tu.toString());
    });
    out.cmapRefs=cmapOf;
    const csObj=d2.context.lookup(pgNode.Contents());
    let raw;
    if(csObj instanceof PDF_().PDFArray){
      let parts=[]; for(let i=0;i<csObj.size();i++){const s2=d2.context.lookup(csObj.get(i)); parts.push(s2.contents||s2.getContents());}
      raw=parts.reduce((a,p)=>{const u=new Uint8Array(a.length+p.length);u.set(a,0);u.set(p,a.length);return u;});
    } else raw=csObj.contents||csObj.getContents();
    const ds=new DecompressionStream('deflate');
    const inflated=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer());
    const txt=new TextDecoder('latin1').decode(inflated);
    const iTr=txt.indexOf('2 Tr');
    out.aroundTr = iTr>=0 ? txt.slice(Math.max(0,iTr-260), iTr+120) : 'no 2 Tr';
    // 解出每个 ToUnicode 的 bfchar
    const maps={};
    fonts.entries().forEach(([k,v])=>{
      const f=d2.context.lookup(v);
      const tu=f.get(PDF_().PDFName.of('ToUnicode'));
      if(!tu) return;
      const s=d2.context.lookup(tu);
      const rr=s.contents||s.getContents();
      // 同步解压不可行，跳过——改用 fetch/async？这里先记录长度
      maps[k.asString()]='len='+rr.length;
    });
    out.mapLens=maps;
    return out;
  })()`);
  console.log('DBG16c', JSON.stringify(steps, null, 1));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
