/* 编辑器界面截图探针 */
const fs = require('fs');
const path = require('path');
const PORT = process.env.CDP_PORT || 9234;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let list;
  for (let i = 0; i < 20; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; }
    catch (e) { await sleep(800); }
  }
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); const ctxs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.executionContextCreated') ctxs.push(m.params.context);
  };
  const send = (method, params) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, m => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 120000);
  });
  await send('Runtime.enable'); await send('Page.enable');
  await sleep(2000);
  const ctx = ctxs.find(c => !c.name) || ctxs[ctxs.length - 1];
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, contextId: ctx.id, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text).slice(0, 300));
    return r.result.value;
  };
  const b64 = fs.readFileSync(path.join(__dirname, 'test-a.pdf')).toString('base64');
  await ev(`window.__E2E__=1; (async()=>{ await __PS.testOpenDoc('test-a.pdf','${b64}'); __PS.testResetEdits(); await __PS.openEditor(0); })()`);
  await sleep(1500);
  console.log('UI', JSON.stringify(await ev(`__PS.testEditorUI()`)));
  // 模拟点击第一行文字
  await ev(`(async()=>{ const L=await __PS.testFindLine(0,'Sample'); await __PS.testEditLine(0,L.i,'已修改：合同编号已更新','#c53a25'); })()`);
  await sleep(600);
  console.log('float', JSON.stringify(await ev(`({show:getComputedStyle(document.getElementById('edFloat')).display, val:(document.getElementById('edInput')||{}).value})`)));
  const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: false, captureBeyondViewport: false });
  fs.writeFileSync(path.join(__dirname, 'editor-fixed.png'), Buffer.from(r.data, 'base64'));
  console.log('shot editor-fixed.png');
  ws.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
