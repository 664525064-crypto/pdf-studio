/* 截图探针：整段编辑框 + 提交后的原位预览 */
const fs = require('fs');
const path = require('path');
const PORT = process.env.CDP_PORT || 9234;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pend = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params, timeout = 30000) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  return { ws, send };
}
async function ev(send, expr, timeout = 60000) {
  const m = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true }, timeout);
  if (m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 400));
  return m.result.result.value;
}
async function shot(send, file) {
  try {
    const b64 = await ev(send, `(async()=>{ try{ return await window.__PDFSTUDIO_BRIDGE__.shot(); }catch(e){ return null; } })()`, 30000);
    if (!b64) throw new Error('empty');
    fs.writeFileSync(path.join(__dirname, file), Buffer.from(b64, 'base64'));
    console.log('shot ok', file);
  } catch (e) { console.log('shot fail', file, e.message); }
}

const GEN = fs.readFileSync(path.join(__dirname, 'gen_para.js'), 'utf8');

(async () => {
  const { ws, send } = await connect();
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 940, deviceScaleFactor: 1, mobile: false }, 10000).catch(() => {});
  await ev(send, `window.__E2E__=true`);
  const b64 = await ev(send, GEN, 60000);
  await ev(send, `__PS.testOpenDoc('para.pdf', ${JSON.stringify(b64)})`, 60000);
  await ev(send, `(async()=>{ await __PS.openEditor(0); return true; })()`, 90000);
  await sleep(600);
  await shot(send, 'ui-para-list.png');

  // 点第 2 段（2 行）→ 出整段编辑框
  await ev(send, `(()=>{ const g=__PS.editor.paras[1]; document.querySelector('.tline[data-i="'+g[0]+'"]').click(); return true; })()`);
  await sleep(400);
  await shot(send, 'ui-para-edit.png');

  // 改成更长的段落并提交 → 预览
  const txt = '（二）保险标的自身缺陷、保管不善导致的损毁，保险标的的氧化、腐蚀、锈损、自然损耗、自然磨损所造成的损失和费用；本条还包含因停放期间被水浸泡、动物啃咬、人为划伤等造成的损失，保险人按实际损失赔付。';
  await ev(send, `(()=>{ const d=document.querySelector('.edin.para'); d.focus(); d.innerHTML=${JSON.stringify(txt)}; d.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,bubbles:true,cancelable:true})); return true; })()`);
  await sleep(500);
  await shot(send, 'ui-para-after.png');

  ws.close(); process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
