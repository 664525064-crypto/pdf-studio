/* 打开「改两轮后的保存文件」，截编辑区，验证视觉无叠字 */
const fs = require('fs');
const file = process.argv[2] || 'out/erase_r4_编辑_编辑.pdf';
const b64 = fs.readFileSync(__dirname + '/' + file).toString('base64');
const name = file.split('/').pop();
(async () => {
  const list = await (await fetch('http://127.0.0.1:'+(process.env.CDP_PORT||9234)+'/json/list')).json();
  const tab = list.find(t => t.type === 'page');
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (m, p, t = 120000) => new Promise((res, rej) => { const id = ++seq; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p || {} })); setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + m)); } }, t); });
  const ev = async (x, t = 120000) => {
    const m = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true }, t);
    if (m.result.exceptionDetails) return 'EXC:' + JSON.stringify(m.result.exceptionDetails).slice(0, 600);
    return m.result.result.value;
  };
  await ev(`(async()=>{ await __PS.testOpenDoc(${JSON.stringify(name)},'${b64}'); await new Promise(r=>setTimeout(r,1500)); await __PS.openEditor(0); await new Promise(r=>setTimeout(r,2500)); return 1; })()`);
  const info = await ev(`({lines: document.querySelectorAll('.tline').length, edits: (window.ED&&ED.edits?ED.edits.length:-1)})`);
  console.log('state:', JSON.stringify(info));
  const data = await ev(`(async()=>{ await new Promise(r=>setTimeout(r,600)); return await window.__PDFSTUDIO_BRIDGE__.shot(); })()`, 60000);
  if (typeof data === 'string' && data.length > 1000) {
    fs.writeFileSync(__dirname + '/float_after.png', Buffer.from(data.replace(/^data:image\/png;base64,/, ''), 'base64'));
    console.log('shot ok');
  } else console.log('shot fail', String(data).slice(0, 120));
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
