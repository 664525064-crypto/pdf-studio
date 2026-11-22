/* 复现用户两组问题：①改完字变灰 ②加了字框不变长、右边有空地却折行
   造一份跟截图同构的单据（短字段行，宋体 10.5），量墨色与可用宽度 */
const PORT = process.env.CDP_PORT || 9234;
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
    if (m.result.exceptionDetails) throw new Error(JSON.stringify(m.result.exceptionDetails).slice(0, 900));
    return m.result.result.value;
  };
  return { ws, ev };
}

const GEN = `(async()=>{
  const {PDFDocument, rgb}=PDFLib;
  const doc=await PDFDocument.create(); doc.registerFontkit(window.fontkit);
  const fb=await window.__PDFSTUDIO_BRIDGE__.font('song');
  const font=await doc.embedFont(fb.bytes,{subset:true});
  const page=doc.addPage([595,842]);
  const size=10.5, left=72;
  const rows=[
    ['保险合同争议解决方式：  诉讼', 760],
    ['出单机构：  成都市锦江支公司综合部', 730],
    ['（成都）', 708],
    ['签单日期：    年   月   日', 676],
    ['保险人联系地址：  四川省成都市锦江区楷字宫南街57号', 646]
  ];
  for(const [t,y] of rows) page.drawText(t, {x:left, y, size, font, color:rgb(0,0,0)});
  const bytes=await doc.save(); let bin='';
  for(let i=0;i<bytes.length;i+=8192) bin+=String.fromCharCode.apply(null, bytes.subarray(i,i+8192));
  return btoa(bin);
})()`;

(async () => {
  const { ev } = await conn();
  const b64 = await ev(GEN);
  const r1 = await ev(`(async()=>{
    window.__E2E__=1; __PS.testResetEdits && __PS.testResetEdits();
    await __PS.testOpenDoc('fields.pdf', ${JSON.stringify('' )}+${JSON.stringify(b64)});
    __PS.selectTool('edittext');
    await __PS.openEditor(0);
    const E=__PS.editor;
    return { scale:+E.scale.toFixed(2), vpW:Math.round(E.vpW),
             lines:E.lines.map(l=>({t:l.text.slice(0,26), x:Math.round(l.x), x2:Math.round(l.x2), ink:l.ink})),
             paras:(E.paras||[]).map(g=>({n:g.length, first:(E.lines[g[0]]||{}).text.slice(0,18)})) };
  })()`);
  console.log('① 行墨色 / 段落:', JSON.stringify(r1, null, 1));

  /* 单行加字：签单日期那行（第 3 行）加 2026年09月77709日 */
  const r2 = await ev(`(async()=>{
    const E=__PS.editor;
    let i=E.lines.findIndex(l=>l.text.indexOf('签单日期')>=0);
    const old=E.lines[i].text;
    const avW=__PS.testAvailW ? __PS.testAvailW(i) : null;
    const r=await __PS.testInlineEdit(0, i, '签单日期：2026年09月77709日');
    const rec=__PS.editor.edits.filter(e=>e.page===0).pop();
    return { i, old, avW, r, rec:rec?{multi:!!rec.multi, w:Math.round(rec.w), x:Math.round(rec.x), text:rec.text.slice(0,30)}:null };
  })()`);
  console.log('② 单行加字:', JSON.stringify(r2, null, 1));

  /* 整段路径：直接点这一行（单行段）→ 框宽度应接近页面可用宽度 */
  const r3 = await ev(`(async()=>{
    __PS.testResetEdits && __PS.testResetEdits();
    const E=__PS.editor;
    let i=E.lines.findIndex(l=>l.text.indexOf('出单机构')>=0);
    const pi=E.paraOf[i];
    const pe=await __PS.testParaEdit(0, pi, '出单机构：成都市锦江支公司综合部（成都）签单日期2026年09月15日 保险人联系地址四川省成都市锦江区楷字宫南街57号（本行故意写长，看会不会用到右边空地）');
    return { pi, scale:+E.scale.toFixed(2), pe };
  })()`);
  console.log('③ 整段框宽度:', JSON.stringify(r3, null, 1));
  process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
