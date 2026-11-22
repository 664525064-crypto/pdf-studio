/* 侧栏可见性探针：截图 + 检查滚动/搜索 */
const fs = require('fs');
const path = require('path');
const PORT = 9234;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.executionContextCreated') ctxs.push(m.params.context);
  };
  const send = (method, params) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, 40000);
  });
  await send('Runtime.enable'); await send('Page.enable');
  await sleep(2500);
  const ctx = ctxs.find(c => !c.name) || ctxs[ctxs.length - 1];
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, contextId: ctx.id, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text).slice(0, 300));
    return r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png', fromSurface: false, captureBeyondViewport: false });
    fs.writeFileSync(path.join(__dirname, name), Buffer.from(r.data, 'base64'));
    console.log('shot', name);
  };

  // 初始状态
  const info = await ev(`(()=>{const b=document.getElementById('tools');const btns=[...document.querySelectorAll('.tbtn')];return {
    count:btns.length, scrollH:b.scrollHeight, clientH:b.clientHeight, scrollable:b.scrollHeight>b.clientHeight+2,
    overflow:getComputedStyle(b).overflowY, visible:btns.filter(x=>{const r=x.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}).length,
    names:btns.map(x=>x.textContent.trim())
  };})()`);
  console.log('INIT', JSON.stringify(info, null, 1));
  await shot('side-top.png');

  // 滚到底部
  await ev(`document.getElementById('tools').scrollTop=99999; 'ok'`);
  await sleep(400);
  const bottom = await ev(`(()=>{const btns=[...document.querySelectorAll('.tbtn')];return btns.filter(x=>{const r=x.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}).map(x=>x.textContent.trim());})()`);
  console.log('BOTTOM VISIBLE', JSON.stringify(bottom));
  await shot('side-bottom.png');

  // 搜索 Word
  await ev(`(()=>{const i=document.getElementById('tsearch');i.value='word';i.dispatchEvent(new Event('input'));return 'ok';})()`);
  await sleep(400);
  console.log('SEARCH word ->', JSON.stringify(await ev(`[...document.querySelectorAll('.tbtn')].map(x=>x.textContent.trim())`)));
  await shot('side-search.png');

  // 搜索 编辑
  await ev(`(()=>{const i=document.getElementById('tsearch');i.value='编辑';i.dispatchEvent(new Event('input'));return 'ok';})()`);
  await sleep(300);
  console.log('SEARCH 编辑 ->', JSON.stringify(await ev(`[...document.querySelectorAll('.tbtn')].map(x=>x.textContent.trim())`)));

  // 清空 + 点击 PDF 转 Word
  await ev(`(()=>{const i=document.getElementById('tsearch');i.value='';i.dispatchEvent(new Event('input'));return 'ok';})()`);
  await sleep(200);
  const clicked = await ev(`(()=>{document.getElementById('tb_p2docx').click();return {title:document.getElementById('ptitle').textContent,on:document.querySelectorAll('.tbtn.on').length};})()`);
  console.log('CLICK p2docx', JSON.stringify(clicked));
  await sleep(300);
  await shot('side-click.png');
  ws.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
