/* probe7: 复现 拆分 / 解密 失败并读取状态栏 */
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); let ctxs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.executionContextCreated') ctxs.push(m.params.context);
  };
  const send = (method, params, timeout = 15000) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  await send('Runtime.enable');
  await new Promise(r => setTimeout(r, 800));
  const main = ctxs.filter(c => !c.name).pop() || ctxs[ctxs.length - 1];
  const ev = async (expr, timeout) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true, contextId: main.id }, timeout || 30000);
    if (r.exceptionDetails) throw new Error('JS异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).slice(0, 250));
    return r.result.value;
  };
  const bA = fs.readFileSync(path.join(__dirname, 'test-a.pdf')).toString('base64');
  const bEnc = fs.readFileSync(path.join(__dirname, 'test-enc.pdf')).toString('base64');
  await ev(`window.__E2E__=1; 'ok'`);

  console.log('== 拆分 ==');
  await ev(`(async()=>{ await __PS.testOpenDoc('test-a.pdf','${bA}'); __PS.selectTool('split'); document.getElementById('f_ranges').value='1-2,3'; await __PS.testRun(); return 'done'; })()`, 60000).catch(e => 'HANG ' + e.message);
  await sleep(800);
  console.log('status:', await ev('document.getElementById("status").textContent'));
  console.log('saved:', await ev('__PS_SAVED__.map(f=>f.name).join(",")'));

  console.log('== 解密 ==');
  await ev(`(async()=>{ await __PS.testOpenDoc('test-enc.pdf','${bEnc}'); __PS.selectTool('decrypt'); document.getElementById('f_dp').value='1234'; await __PS.testRun(); return 'done'; })()`, 60000).catch(e => 'HANG ' + e.message);
  await sleep(800);
  console.log('status:', await ev('document.getElementById("status").textContent'));
  console.log('saved:', await ev('__PS_SAVED__.map(f=>f.name).join(",")'));

  // 直接试 pdf-lib 密码加载
  console.log('lib load pw:', await ev(`(async()=>{ try{ const bytes=Uint8Array.from(atob('${bEnc}'),c=>c.charCodeAt(0)); const d=await PDFLib.PDFDocument.load(bytes.slice(), {password:'1234'}); return 'loaded:'+d.getPageCount(); }catch(e){ return 'ERR:'+(e.message||e).slice(0,120); } })()`, 30000));
  ws.close(); setTimeout(() => process.exit(0), 200);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
