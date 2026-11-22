// 探 pdf.js 渲染替换图 PDF：console 警告 + opList 图像操作
(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = new Map(); const logs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + (m.params.args || []).map(a => a.value !== undefined ? String(a.value) : (a.description || '')).join(' ').slice(0, 200));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + ((m.params.exceptionDetails.exception || {}).description || m.params.exceptionDetails.text || '').slice(0, 200));
  };
  const send = (method, params, timeout) => new Promise((res, rej) => {
    const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => rej(new Error('timeout ' + method)), timeout || 20000);
  });
  await send('Runtime.enable');
  const fs = require('fs');
  const b = fs.readFileSync('_out/test-a_替换图.pdf').toString('base64');
  const ev = async (expr, t) => {
    const r = await Promise.race([
      send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }, t),
      new Promise(r => setTimeout(() => r({ timeout: true }), t))
    ]);
    if (r.timeout) return 'TIMEOUT';
    if (r.error) return 'ERR: ' + r.error.message;
    if (r.exceptionDetails) return 'EXC: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 400);
    return JSON.stringify(r.result && r.result.result && r.result.result.value);
  };
  console.log('1 opList:', await ev('(async()=>{ const b=Uint8Array.from(atob("' + b + '"),c=>c.charCodeAt(0)); const d=await pdfjsLib.getDocument({data:b}).promise; const pg=await d.getPage(1); const ol=await pg.getOperatorList(); const OPS=pdfjsLib.OPS; const imgs=[]; for(let i=0;i<ol.fnArray.length;i++){ if(ol.fnArray[i]===OPS.paintImageXObject) imgs.push(ol.argsArray[i][0]); } return {imgs, fns:ol.fnArray.length}; })()', 40000));
  console.log('2 render+scan:', await ev('(async()=>{ const b=Uint8Array.from(atob("' + b + '"),c=>c.charCodeAt(0)); const d=await pdfjsLib.getDocument({data:b}).promise; const pg=await d.getPage(1); const vp=pg.getViewport({scale:2}); const cv=document.createElement("canvas"); cv.width=vp.width; cv.height=vp.height; const c2=cv.getContext("2d"); await pg.render({canvasContext:c2, viewport:vp, intent:"print"}).promise; const im=c2.getImageData(0,0,cv.width,cv.height).data; let nonWhite=0, red=0; for(let i=0;i<im.length;i+=4){ if(im[i]<250||im[i+1]<250||im[i+2]<250) nonWhite++; if(im[i]>200&&im[i+1]<100) red++; } return {nonWhite, red}; })()', 60000));
  console.log('--- console ---');
  logs.slice(-15).forEach(l => console.log(l));
  process.exit(0);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
