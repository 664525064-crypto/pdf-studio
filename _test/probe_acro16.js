/* 探针16：真实保存文件中 Tr 2 块的 Tf 引用与资源字典比对 */
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
    window.__PS_SAVED__.length=0;
    await __PS.testSaveEdits();
    const u8=window.__PS_SAVED__[0].bytes;
    const d2=await PDF_().PDFDocument.load(u8);
    const pgNode=d2.getPage(0).node;
    const fonts=pgNode.Resources().lookup(PDF_().PDFName.of('Font'));
    const keys=[];
    fonts.entries().forEach(([k,v])=>{
      const f=d2.context.lookup(v);
      const tu=f.get(PDF_().PDFName.of('ToUnicode'));
      keys.push({key:k.asString(), base:(f.get(PDF_().PDFName.of('BaseFont'))||'').toString(), tu:tu?'YES':'MISSING'});
    });
    // 内容流找 Tf 上下文
    const csObj=d2.context.lookup(pgNode.Contents());
    let raw;
    if(csObj instanceof PDF_().PDFArray){
      let parts=[]; for(let i=0;i<csObj.size();i++){const s=d2.context.lookup(csObj.get(i)); parts.push(s.contents||s.getContents());}
      raw=parts.reduce((a,p)=>{const u=new Uint8Array(a.length+p.length);u.set(a,0);u.set(p,a.length);return u;});
    } else raw=csObj.contents||csObj.getContents();
    const ds=new DecompressionStream('deflate');
    const inflated=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer());
    const txt=new TextDecoder('latin1').decode(inflated);
    const tfs=[...new Set((txt.match(/\\/[A-Za-z0-9+_.-]+ \\d+(?:\\.\\d+)? Tf/g)||[]))];
    const trCtx=(txt.match(/.{0,120}2 Tr.{0,80}/g)||[]).slice(0,3);
    return {keys, tfs, trCtx};
  })()`);
  console.log('DBG16', JSON.stringify(r, null, 1));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
