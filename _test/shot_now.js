/* 从当前 CDP 页面抓一张图（尝试多种参数，规避窗口被遮挡时超时） */
const fs = require('fs');
const path = require('path');
const PORT = 9234;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OUT = process.argv[2] || 'screen-cdp.png';

(async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const raw = (method, params, timeout = 20000) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, m => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  await raw('Page.enable');
  await sleep(300);
  await raw('Page.bringToFront', {}, 15000).catch(() => {});
  await sleep(600);
  const tries = [
    { format: 'png', fromSurface: true, captureBeyondViewport: false },
    { format: 'png', fromSurface: false, captureBeyondViewport: false },
    { format: 'jpeg', quality: 92, fromSurface: true, captureBeyondViewport: false }
  ];
  for (const t of tries) {
    try {
      const s = await raw('Page.captureScreenshot', t, 45000);
      const f = path.join(__dirname, OUT);
      fs.writeFileSync(f, Buffer.from(s.data, 'base64'));
      console.log('SHOT', f, JSON.stringify(t), s.data.length);
      ws.close(); setTimeout(() => process.exit(0), 150); return;
    } catch (e) { console.log('fail', JSON.stringify(t), e.message); await sleep(500); }
  }
  console.error('ALL_FAIL');
  ws.close(); setTimeout(() => process.exit(2), 150);
})().catch(e => { console.error('FATAL', e.message); process.exit(3); });
