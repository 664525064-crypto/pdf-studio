// 快速诊断：当前 CDP 实例的 app:// 根目录到底是哪里
const PORT = process.env.CDP_PORT || 9234;
const run = async () => {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params) => new Promise((res, rej) => { const id = ++seq; pending.set(id, m => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({ id, method, params: params || {} })); setTimeout(() => rej(new Error('timeout')), 15000); });
  await send('Runtime.enable');
  const expr = `(async()=>{
    const probe = async (u) => { try { const r = await fetch(u); return { ok: r.ok, status: r.status }; } catch(e) { return { err: String(e) }; } };
    const main = await fetch(location.href, {cache:'reload'}).then(r=>r.text());
    return {
      marker: await probe('app://pdfstudio/_test/probe_html_diag.js'),
      himg: main.includes('himg'),
      len: main.length
    };
  })()`;
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result.value));
  process.exit(0);
};
run().catch(e => { console.error('FATAL', e.message); process.exit(1); });
