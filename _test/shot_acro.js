/* 截图（鲁棒重试版） */
const fs = require('fs');
const path = require('path');
(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params, timeout=12000) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async x => {
    const m = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true });
    if (m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails.exception && m.result.exceptionDetails.exception.description || m.result.exceptionDetails).slice(0, 300));
    return m.result.result.value;
  };
  const tryShot = async name => {
    for (let i = 0; i < 10; i++) {
      try {
        const m = await send('Page.captureScreenshot', { format: 'jpeg', quality: 85, fromSurface: i % 2 === 0 }, 8000);
        if (m && m.result && m.result.data) { fs.writeFileSync(path.join(__dirname, name), Buffer.from(m.result.data, 'base64')); console.log('saved', name, 'attempt', i); return true; }
      } catch (e) { /* retry */ }
      await new Promise(r => setTimeout(r, 1500));
    }
    console.log('FAILED', name);
    return false;
  };

  await new Promise(r => setTimeout(r, 1500));
  await tryShot('shot0_home.png');

  const bA = fs.readFileSync('test-a.pdf').toString('base64');
  await ev(`(async()=>{ await __PS.testOpenDoc('test-a.pdf','${bA}'); await __PS.openEditor(0); })()`);
  await new Promise(r => setTimeout(r, 1500));
  // 点一行 → 格式条
  await ev(`(async()=>{
    const ov=document.querySelector('.edov');
    if(!ov) return 'no overlay';
    const r=ov.getBoundingClientRect();
    const mk=(t,x,y)=>new MouseEvent(t,{bubbles:true,clientX:x,clientY:y});
    ov.dispatchEvent(mk('mousedown',r.left+5,r.top+5));
    ov.dispatchEvent(mk('mouseup',r.left+5,r.top+5));
    await new Promise(r2=>setTimeout(r2,400));
    return document.querySelector('#edFmt') ? 'fmt-on' : 'fmt-off';
  })()`);
  await tryShot('shot1_fmtbar.png');
  // 插入文本 + 图片
  const b64 = fs.readFileSync('img1.png').toString('base64');
  await ev(`(async()=>{
    const bin=Uint8Array.from(atob('${b64}'),c=>c.charCodeAt(0));
    ED.news.push({page:ED.page,nwId:'n1',x:100,y:760,size:14,color:'#1e6fd9',fam:'song',text:'新增备注：本单一经签收即视为送达',w:260,lh:1.5,bold:true,italic:false,align:'left'});
    ED.regions.push({page:ED.page,img:bin,x:120,y:560,w:135,h:90});
    edPaintOverlays(); edSyncSide();
    return 'added';
  })()`);
  await tryShot('shot2_insert.png');
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
