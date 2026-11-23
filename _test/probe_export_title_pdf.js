/* 导出最后保存的 PDF → 用 pdf.js 独立渲染第 1 页 → 裁剪标题区 */
const path = require('path');
const fs = require('fs');

const run = async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params, timeout = 60000) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, m => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  await send('Runtime.enable');
  // 关键坑：分块大小不是 3 的倍数时 btoa 补 padding，必须每块独立 decode 再 concat
  const meta = await send('Runtime.evaluate', { expression: `__PS_SAVED__.length`, returnByValue: true });
  const n = meta.result.value;
  const out = path.join(__dirname, '_out', '保单_标题字体验证.pdf');
  const chunks = [];
  for (let off = 0; ; off += 1048576) {
    const r = await send('Runtime.evaluate', { expression: `(function(){
      const b=__PS_SAVED__[__PS_SAVED__.length-1].bytes;
      if(${off} >= b.length) return null;
      const end=Math.min(${off}+1048576, b.length);
      let s=''; const u8=b.subarray(${off}, end);
      for(let i=0;i<u8.length;i+=0x8000) s+=String.fromCharCode.apply(null, u8.subarray(i, i+0x8000));
      return btoa(s);
    })()`, returnByValue: true });
    if (r.result.value === null) break;
    chunks.push(Buffer.from(r.result.value, 'base64'));
    process.stdout.write('.');
  }
  const buf = Buffer.concat(chunks);
  fs.writeFileSync(out, buf);
  console.log('\nEXPORT:', out, buf.length, 'bytes, entries:', n);
  process.exit(0);
};
run().catch(e => { console.error('FATAL', e.message); process.exit(1); });
