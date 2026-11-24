/* 生成扫描件语料：把 C_table.pdf 渲染成 PNG → 只含图片的 PDF（无文字层）
   运行：先启动 dev（9234），CDP_PORT=9234 node _mk_scan.js */
const path = require('path');
const fs = require('fs');

const PORT = process.env.CDP_PORT || '9234';
const OUT = path.join(__dirname, '_audit', 'F_scan_table.pdf');

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params, timeout = 60000) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, m => m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async (expr, timeout) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, timeout || 60000);
    if (r.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails).slice(0, 500));
    return r.result.value;
  };
  return { ws, send, ev };
}

(async () => {
  const { ev } = await connect();
  const b64 = fs.readFileSync(path.join(__dirname, '_audit', 'C_table_light.pdf')).toString('base64');
  const n = await ev(`(async()=>{
    const raw = Uint8Array.from(atob('${b64}'), c=>c.charCodeAt(0));
    const doc = await pdfjsLib.getDocument({data: raw}).promise;
    const pg = await doc.getPage(1);
    const vp = pg.getViewport({scale: 2.4});
    const cv = document.createElement('canvas');
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d');
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,cv.width,cv.height);
    await pg.render({canvasContext: ctx, viewport: vp}).promise;
    const url = cv.toDataURL('image/png');
    const b64raw = url.slice(url.indexOf(',') + 1);   // 去掉 data:image/png;base64,
    const CH = 0x8000; const arr = [];
    for (let i = 0; i < b64raw.length; i += CH) arr.push(b64raw.substr(i, CH));
    window.__SCAN_CH = arr;
    return arr.length;
  })()`, 120000);
  let b64all = '';
  for (let i = 0; i < n; i++) b64all += await ev(`window.__SCAN_CH[${i}]`);
  const buf = Buffer.from(b64all, 'base64');

  /* 只含图片的 PDF（页面 pt 尺寸 = 原页尺寸） */
  const { PDFDocument } = require(path.join(__dirname, '..', 'renderer', 'vendor', 'pdf-lib.min.js'));
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(buf);
  const pw = img.width / 2.4, ph = img.height / 2.4;
  const pg = doc.addPage([pw, ph]);
  pg.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
  fs.writeFileSync(OUT, await doc.save());
  console.log('written:', OUT, 'page', Math.round(pw), 'x', Math.round(ph));
  process.exit(0);
})().catch(e => { console.error('ERR', e); process.exit(1); });
