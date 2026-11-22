/* probe11: 不重载，扫描全部上下文的响应性 */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  console.log('targets:', list.map(t => t.type + ':' + t.url.slice(0, 50)).join(' | '));
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map(); const ctxs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.executionContextCreated') ctxs.push(m.params.context);
  };
  const send = (method, params, timeout = 8000) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  await send('Runtime.enable');
  await sleep(1000);
  console.log('contexts:', JSON.stringify(ctxs.map(c => c.id + ':' + (c.name || '(main)'))));
  for (const c of ctxs) {
    const t0 = Date.now();
    try {
      const r = await send('Runtime.evaluate', { expression: '1+1', contextId: c.id, returnByValue: true }, 5000);
      console.log(`ctx ${c.id} (${c.name || 'main'}): 1+1=${JSON.stringify(r.result && r.result.value)} in ${Date.now() - t0}ms`);
    } catch (e) {
      console.log(`ctx ${c.id} (${c.name || 'main'}): FAIL ${e.message} in ${Date.now() - t0}ms`);
    }
  }
  // 默认上下文（不带 contextId）
  const t0 = Date.now();
  const r = await send('Runtime.evaluate', { expression: '1+1', returnByValue: true }, 5000).catch(e => ({ err: e.message }));
  console.log('default ctx:', JSON.stringify(r.result && r.result.value || r), `in ${Date.now() - t0}ms`);
  ws.close(); setTimeout(() => process.exit(0), 200);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
