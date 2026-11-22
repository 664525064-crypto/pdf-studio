// 探原始页面 695-716 行带的暗像素分布（找字形真实边界）
(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params, timeout) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => rej(new Error('timeout ' + method)), timeout || 20000);
  });
  await send('Runtime.enable');
  const fs = require('fs');
  const bA = fs.readFileSync('test-a.pdf', 'base64');
  const ev = async (expr, t) => {
    const r = await Promise.race([
      send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }, t),
      new Promise(r => setTimeout(() => r({ timeout: true }), t))
    ]);
    if (r.timeout) return 'TIMEOUT';
    if (r.error) return 'ERR: ' + r.error.message;
    if (r.exceptionDetails) return 'EXC: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 300);
    return JSON.stringify(r.result && r.result.result && r.result.result.value);
  };
  // 原始文档：扫描行带 y∈[695,716] 的暗像素列分布（按 pdf x 每 1pt 一桶）
  console.log('orig band:', await ev('(async()=>{ await __PS.testOpenDoc("test-a.pdf","' + bA + '"); const pg=await __PS.state.jsDoc.getPage(1); const vp=pg.getViewport({scale:2}); const cv=document.createElement("canvas"); cv.width=vp.width; cv.height=vp.height; await pg.render({canvasContext:cv.getContext("2d"), viewport:vp, intent:"print"}).promise; const c2=cv.getContext("2d"); const im=c2.getImageData(0,0,cv.width,cv.height).data; const buckets={}; for(let py=0;py<vp.height;py++){ const pdfY=842-py/2; if(pdfY<695||pdfY>716) continue; for(let px=0;px<vp.width;px++){ const i=(py*vp.width+px)*4; if(im[i]<200){ const pdfX=px/2; const b=Math.floor(pdfX); buckets[b]=(buckets[b]||0)+1; } } } const ks=Object.keys(buckets).map(Number).sort((a,b)=>a-b); return ks.map(k=>k+":"+buckets[k]).join(","); })()', 40000));
  process.exit(0);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
