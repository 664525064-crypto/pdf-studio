/* 调试：f1 之后 f2 返回 null 的原因 */
const fs = require('fs');
const b64 = fs.readFileSync(__dirname + '/policy_p1.pdf').toString('base64');

(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params, timeout = 120000) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async (x, t = 120000) => {
    const m = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true }, t);
    if (m.result.exceptionDetails) return 'EXC:' + JSON.stringify(m.result.exceptionDetails).slice(0, 500);
    return m.result.result.value;
  };

  console.log('boot', await ev(`(async()=>{ __PS.testResetEdits(); await __PS.testOpenDoc('policy_p1.pdf','${b64}'); await new Promise(r=>setTimeout(r,1200)); await __PS.openEditor(0); await new Promise(r=>setTimeout(r,1500));
    return {n:ED.lines.length, has:ED.lines.filter(function(l){return (l.text||'').indexOf('签单日期')>=0}).length,
            tl:document.querySelectorAll('.tline').length}; })()`, 180000));

  console.log('f1', JSON.stringify(await ev(`(async()=>{
    __PS.testResetEdits();
    var i=__PS.editor.lines.findIndex(function(l){return l.text.indexOf('签单日期')>=0});
    var r=await __PS.testInlineEdit(0, i, '签单日期：2026年09月77709日');
    return {i, r, nTl:document.querySelectorAll('.tline').length, nIn:document.querySelectorAll('.edin').length,
            page:ED.page, lines:ED.lines.length};
  })()`, 90000)));

  console.log('f2', JSON.stringify(await ev(`(async()=>{
    __PS.testResetEdits();
    var i=__PS.editor.lines.findIndex(function(l){return l.text.indexOf('签单日期')>=0});
    var pre={i, page:ED.page, lines:ED.lines.length, nTl:document.querySelectorAll('.tline').length,
             L:ED.lines[i]?{text:ED.lines[i].text.slice(0,20),y:ED.lines[i].y}:null,
             hasTl:!!document.querySelector('.tline[data-i="'+i+'"]'),
             eds:document.querySelectorAll('.edin').length, tls:[...document.querySelectorAll('.tline')].map(function(n){return +n.dataset.i})};
    var r=await __PS.testInlineEdit(0, i, '签单日期：2026年09月77709日 出单机构：成都市锦江支公司综合部 保险人联系地址四川省成都市锦江区楷字宫南街57号');
    return {pre, r};
  })()`, 90000)));
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
