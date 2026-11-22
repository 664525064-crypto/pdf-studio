/* 探针：用应用里的 ensureFont 写中文 → pdf.js 读回，验证嵌入字体的 ToUnicode 是否正确 */
const PORT = 9234;
async function conn() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params, timeout = 60000) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async expr => {
    const m = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 500));
    return m.result.result.value;
  };
  return { ws, ev };
}
(async () => {
  const { ws, ev } = await conn();
  const out = await ev(`(async()=>{
    const PL=PDFLib_, lib=window.pdfjsLib;
    const res={};
    const sample='司法管辖：中国境内（不含港澳台）保险费叁佰陆拾捌万零壹佰元整墍';
    for(const fam of ['song','hei','kai','fang']){
      try{
        const doc=await PL.PDFDocument.create(); doc.registerFontkit(window.fontkit);
        const f=await ensureFont(doc,fam);
        const p=doc.addPage([595,842]);
        p.drawText(sample,{x:50,y:760,size:12,font:f});
        const bytes=await doc.save({useObjectStreams:true});
        const d=await lib.getDocument({data:bytes.slice()}).promise;
        const pg=await d.getPage(1); const tc=await pg.getTextContent();
        const got=tc.items.map(i=>i.str).join('');
        const it=tc.items.find(i=>i.str.trim());
        res[fam]={ok:got===sample, got:got.slice(0,40), h:it?+it.height.toFixed(2):null,
                  tr:it?[+it.transform[2].toFixed(2),+it.transform[3].toFixed(2)]:null,
                  w:it?+it.width.toFixed(1):null};
      }catch(e){ res[fam]={err:String(e&&e.message||e).slice(0,120)}; }
    }
    return JSON.stringify(res,null,1);
  })()`);
  console.log(out);
  ws.close(); process.exit(0);
})();
