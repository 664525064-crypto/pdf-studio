// 验证页面加载的代码版本 + 单跑编辑用例
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
  console.log('0 code version:', await ev('typeof effLen==="function" ? "NEW" : "OLD"', 10000));
  console.log('1 delete run:', await ev('(async()=>{ __PS_SAVED__.length=0; __PS.selectTool("edittext"); window.__E2E__=1; __PS_SAVED__.length=0; await __PS.testOpenDoc("test-a.pdf","' + bA + '"); document.getElementById("f_ekw").value="Sample Text"; document.getElementById("f_etxt").value=""; await __PS.testRun(); return __PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length})); })()', 50000));
  console.log('2 residual:', await ev('(async()=>{ const u8=__PS_SAVED__[0].bytes; const d=await pdfjsLib.getDocument({data:u8.slice()}).promise; const pg=await d.getPage(1); const vp=pg.getViewport({scale:2}); const cv=document.createElement("canvas"); cv.width=vp.width; cv.height=vp.height; await pg.render({canvasContext:cv.getContext("2d"), viewport:vp, intent:"print"}).promise; const hits=window.__PS_LAST_RECTS__||[]; const c2=cv.getContext("2d"); let nonWhite=0; const pos=[]; for(const r of hits){ const x0=Math.max(0,Math.round(r.x*2)), y0=Math.max(0,Math.round((vp.height-(r.y+r.h)*2))), w0=Math.max(1,Math.round(r.w*2)), h0=Math.max(1,Math.round(r.h*2)); const im=c2.getImageData(x0,y0,w0,h0).data; for(let yy=0;yy<h0;yy++)for(let xx=0;xx<w0;xx++){ const i=(yy*w0+xx)*4; if(im[i]<240||im[i+1]<240||im[i+2]<240){ nonWhite++; if(pos.length<10) pos.push([x0+xx,y0+yy,im[i],im[i+1],im[i+2]]); } } } return {hits:hits.length, rect:hits[0], nonWhite, pos}; })()', 50000));
  process.exit(0);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
