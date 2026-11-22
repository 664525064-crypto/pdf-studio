/* 诊断：逐行打印墨高扫描窗口与量到的墨迹范围 */
const PORT = 9234;
async function conn() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params, timeout = 120000) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async expr => {
    const m = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 800));
    return m.result.result.value;
  };
  return { ws, ev };
}
(async () => {
  const { ws, ev } = await conn();
  const r = await ev(`(()=>{
    const E=__PS.editor, cv=document.getElementById('edCanvas');
    const dpr=window.devicePixelRatio||1, sc=E.scale;
    const ctx=cv.getContext('2d',{willReadFrequently:true});
    const img=ctx.getImageData(0,0,cv.width,cv.height), d=img.data, W=cv.width;
    const lum=i=>0.299*d[i]+0.587*d[i+1]+0.114*d[i+2];
    const out=[]; let prevY=null;
    for(const L of E.lines){
      const base=Math.max(L.size||0, L.ocr?(L.h||0):0, L.ocr?0:(E.mainSize||0), 6);
      const gap=prevY!=null?prevY-L.y:null; prevY=L.y;
      let topMul=L.ocr?1.02:1.10;
      if(gap && gap>0 && gap<base*1.35) topMul=Math.min(1.10, Math.max(0.92, gap/(base*1.62)));
      const x0=Math.max(0,Math.floor((L.x-1)*sc*dpr)), x1=Math.min(W-1,Math.ceil((L.x2+1)*sc*dpr));
      const y0=Math.max(0,Math.floor((E.vpH-(L.y+base*topMul))*sc*dpr));
      let y1=Math.min(cv.height-1,Math.ceil((E.vpH-(L.y-base*(L.ocr?0.56:0.42)))*sc*dpr));
      let clamped=false;
      if(gap && gap>0){ const maxH=Math.max(base*0.92,gap*0.90); const lim=Math.round(y0+maxH*sc*dpr);
        if(y1>lim){ y1=Math.max(y0+2,lim); clamped=true; } }
      const rows=[]; let bl=1e9;
      for(let y=y0;y<=y1;y++){ let m=255; for(let x=x0;x<=x1;x++){ const l=lum((y*W+x)*4); if(l<m) m=l; } rows.push([y,m]); if(m<bl) bl=m; }
      const th=bl+42; let ya=-1,yb=-1;
      for(const rr of rows){ if(rr[1]<=th){ if(ya<0) ya=rr[0]; yb=rr[0]; } }
      out.push({t:(L.text||'').slice(0,8), y:+L.y.toFixed(1), h:+L.h.toFixed(1), size:L.size,
        inkH:L.inkH?+L.inkH.toFixed(1):0, win:[y0,y1], clamped, bl, th, ya, yb,
        hp: ya>=0&&yb>ya?+((yb-ya+1)/dpr/sc).toFixed(1):0, rowN:rows.length});
    }
    return out;
  })()`);
  for (const x of r) console.log(JSON.stringify(x));
  ws.close(); process.exit(0);
})().catch(e => { console.log('EX', e.message); process.exit(1); });
