/* 出图 + 校验：①删掉的行不再留虚线框/「已删除」字样 ②侧栏与编辑界面都有「打开文件」 */
const PORT = 9234;
const fs = require('fs'), path = require('path');
async function conn() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params, timeout = 240000) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async expr => {
    const m = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 800));
    return m.result.result.value;
  };
  return { ws, ev };
}
const shot = async (ev, name) => {
  const b = await ev(`window.__PDFSTUDIO_BRIDGE__.shot()`);
  fs.writeFileSync(path.join(__dirname, name), Buffer.from(b, 'base64'));
  console.log('shot', name);
};
const b64 = f => fs.readFileSync(path.join(__dirname, f)).toString('base64');

(async () => {
  const { ev } = await conn();
  const A = b64('test-a.pdf');

  // 1. 打开文字版文档，删掉第一行
  const r = await ev(`(async()=>{
    window.__E2E__=1;
    __PS.testResetEdits();
    await __PS.testOpenDoc('test-a.pdf','${A}');
    __PS.selectTool('edittext');
    await __PS.openEditor(0);
    const info={open:__PS.editor.open, n:__PS.editor.lines.length, texts:__PS.editor.lines.map(l=>l.text.slice(0,18))};
    const L=await __PS.testFindLine(0,'Sample');
    info.line=L;
    if(!L) return info;
    const ed=await __PS.testInlineEdit(0, L.i, '');
    const el=[...document.querySelectorAll('.edov.del')].pop();
    const cs=el?getComputedStyle(el):{};
    return Object.assign(info,{ recText:ed&&ed.rec&&ed.rec.text, delBox:el?{text:el.textContent,bw:cs.borderTopWidth,bs:cs.borderTopStyle,bg:cs.backgroundColor}:null,
             sideN:document.querySelectorAll('#edList .ei').length, sideX:document.querySelectorAll('#edList .eidel').length });
  })()`);
  console.log('删行结果', JSON.stringify(r));
  await new Promise(r => setTimeout(r, 400));
  await shot(ev, 'ui-del-line.png');

  // 2. 退出编辑，拍侧栏（新按钮）
  await ev(`(async()=>{ __PS.closeEditor(); await new Promise(r=>setTimeout(r,300)); })()`);
  const side = await ev(`(function(){ const b=document.getElementById('btnOpenFile'); const r=b.getBoundingClientRect();
    return {text:b.textContent.trim(), w:Math.round(r.width), h:Math.round(r.height), top:Math.round(r.top)}; })()`);
  console.log('侧栏按钮', JSON.stringify(side));
  await shot(ev, 'ui-open-file.png');

  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
