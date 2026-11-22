// 探替换图：跑 replace 模式，解剖保存 PDF 是否含图像对象
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
  const bPng = fs.readFileSync('test.png').toString('base64');
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
  console.log('1 run:', await ev('(async()=>{ window.__E2E__=1; __PS_SAVED__.length=0; __PS.selectTool("editimg"); await __PS.testOpenDoc("test-a.pdf","' + bA + '"); document.getElementById("f_imode").value="rep"; __PS.testSetFile("rimg","new.png","' + bPng + '"); await __PS.testRun(); return {saved:__PS_SAVED__.map(f=>({n:f.name,size:f.bytes.length})), status:document.getElementById("status").textContent, imode:document.getElementById("f_imode").value}; })()', 60000));
  console.log('2 scan:', await ev('(async()=>{ const u8=__PS_SAVED__[0].bytes; const d=await pdfjsLib.getDocument({data:u8.slice()}).promise; const pg=await d.getPage(1); const vp=pg.getViewport({scale:2}); const cv=document.createElement("canvas"); cv.width=vp.width; cv.height=vp.height; await pg.render({canvasContext:cv.getContext("2d"), viewport:vp, intent:"print"}).promise; const c2=cv.getContext("2d"); const {width,height}=pg.getViewport({scale:1}); const rx=width*0.10, rw=width*0.40, rh=height*0.25, ry=height-height*0.10-rh; const im=c2.getImageData(Math.round(rx*2), Math.round(ry*2), Math.round(rw*2), Math.round(rh*2)).data; let nonWhite=0, red=0; for(let i=0;i<im.length;i+=4){ if(im[i]<250||im[i+1]<250||im[i+2]<250) nonWhite++; if(im[i]>200&&im[i+1]<100) red++; } return {nonWhite, red, region:[Math.round(rx),Math.round(ry),Math.round(rw),Math.round(rh)]}; })()', 60000));
  process.exit(0);
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
