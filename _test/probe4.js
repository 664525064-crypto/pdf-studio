/* 定位 openDoc 卡点：重载页面 → 分步执行并打点 */
const fs = require('fs');
const path = require('path');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); const ctxs = []; const logs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.executionContextCreated') ctxs.push(m.params.context);
    if (m.method === 'Log.entryAdded') logs.push('[' + m.params.entry.level + '] ' + (m.params.entry.text || '').slice(0, 200));
    if (m.method === 'Runtime.exceptionThrown') logs.push('[exc] ' + JSON.stringify(m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text).slice(0, 250));
  };
  const send = (method, params, timeout = 15000) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  ctxs.length = 0; // 重载前清空，只收重载后的上下文
  await send('Page.reload');
  await sleep(5000);
  const mainCtx = ctxs.find(c => !c.name) || ctxs[ctxs.length - 1];
  const ev = async (expr, timeout) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true, contextId: mainCtx.id }, timeout || 30000);
    if (r.exceptionDetails) throw new Error('JS异常: ' + ((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text).slice(0, 300));
    return r.result.value;
  };
  console.log('mainCtx:', mainCtx.id);
  console.log('step1 libs:', await ev('!!window.pdfjsLib + "/" + !!window.PDFLib + "/" + typeof window.pdfjsWorker'));
  console.log('step2 workerSrc:', await ev('pdfjsLib.GlobalWorkerOptions.workerSrc'));
  // 最小 PDF（合法 %PDF 空文档）直接 getDocument
  const mini = await ev(`(async()=>{ try { const t0=Date.now(); const doc=await pdfjsLib.getDocument({data:new Uint8Array([37,80,68,70,45,49,46,52,10,37,37,69,79,70])}).promise; return 'resolved:'+doc.numPages+':'+(Date.now()-t0)+'ms'; } catch(e){ return 'ERR:'+(e.message||e).slice(0,100); } })()`, 30000);
  console.log('step3 mini getDocument:', mini);
  const bA = fs.readFileSync(path.join(__dirname, 'test-a.pdf')).toString('base64');
  const t1 = await ev(`(async()=>{ try { const bytes=Uint8Array.from(atob('${bA}'),c=>c.charCodeAt(0)); const t0=Date.now(); const js=await pdfjsLib.getDocument({data:bytes}).promise; return 'resolved:'+js.numPages+'pages:'+(Date.now()-t0)+'ms'; } catch(e){ return 'ERR:'+(e.message||e).slice(0,120); } })()`, 45000);
  console.log('step4 test-a getDocument(no cmap):', t1);
  const t2 = await ev(`(async()=>{ try { const bytes=Uint8Array.from(atob('${bA}'),c=>c.charCodeAt(0)); const t0=Date.now(); const js=await pdfjsLib.getDocument({data:bytes, cMapUrl:'vendor/cmaps/', cMapPacked:true, standardFontDataUrl:'vendor/standard_fonts/'}).promise; return 'resolved:'+js.numPages+'pages:'+(Date.now()-t0)+'ms'; } catch(e){ return 'ERR:'+(e.message||e).slice(0,120); } })()`, 45000);
  console.log('step5 test-a getDocument(with cmap):', t2);
  console.log('--- console logs ---');
  console.log(logs.slice(0, 30).join('\n') || 'clean');
  ws.close(); setTimeout(() => process.exit(0), 200);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
