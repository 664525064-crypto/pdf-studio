/* 复现「编辑后一行被拆成好几个框」：dump 行结构 + 连续编辑同视觉行多个片段后的记录与覆盖框 */
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
    if (m.result.exceptionDetails) return 'EXC:' + JSON.stringify(m.result.exceptionDetails).slice(0, 600);
    return m.result.result.value;
  };

  console.log('boot:', await ev(`(async()=>{ await __PS.testOpenDoc('policy_p1.pdf','${b64}'); await new Promise(r=>setTimeout(r,1200)); await __PS.openEditor(0); await new Promise(r=>setTimeout(r,1500)); return ED.lines.length; })()`, 180000));

  // 1. dump 行结构（只看含关键词的行 + 同 y 分组）
  const dump = await ev(`(()=>{
    const keep=/被保险人|保险期间|总保险金额|投保人/;
    const rows=ED.lines.map((L,i)=>({i,text:L.text,x:+L.x.toFixed(1),x2:+L.x2.toFixed(1),y:+L.y.toFixed(1),size:L.size,n:(L.items||[]).length}));
    const hit=rows.filter(r=>keep.test(r.text));
    return {total:rows.length, hit};
  })()`);
  console.log('LINES:', JSON.stringify(dump, null, 1));

  // 2. 依次编辑同一视觉带上的每个片段：模拟用户在"保险期间"行里一路改过去
  const step = async (kw, repl) => ev(`(async()=>{
    var i=ED.lines.findIndex(function(L){return (L.text||'').indexOf(${JSON.stringify(kw)})>=0});
    if(i<0) return {err:'no line '+${JSON.stringify(kw)}};
    var tl=document.querySelector('.tline[data-i="'+i+'"]'); if(!tl) return {err:'no tline'};
    tl.click();
    var box=null; for(var k=0;k<40 && !(box=document.querySelector('.edin'));k++) await new Promise(r=>setTimeout(r,150));
    if(!box) return {err:'no box'};
    box.focus();
    var t=ED.lines[i].text; var nt=t.replace(${JSON.stringify(repl[0])}, ${JSON.stringify(repl[1])});
    box.textContent = (nt===t) ? t+'X' : nt;
    box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    await new Promise(r=>setTimeout(r,200));
    return {i, old:t, neu:ED.lines[i].text, applied:(ED.inline?null:'committed')};
  })()`, 60000);

  console.log('step1 保险期间 改 09月09→09月08:', JSON.stringify(await step('保险期间', ['09月09','09月08'])));
  console.log('step2 总保险金额 改 叁佰陆拾捌→叁佰陆拾柒:', JSON.stringify(await step('总保险金额', ['叁佰陆拾捌','叁佰陆拾柒'])));
  console.log('step3 被保险人 改 安润→安泰:', JSON.stringify(await step('被保险人', ['安润','安泰'])));

  // 3. 记录 + 覆盖框几何
  const state = await ev(`(()=>({
    recs: ED.edits.map(e=>({suffix:!!e.suffix,multi:!!e.multi,x:+(e.x||0).toFixed(1),w:+(e.w||0).toFixed(1),y:+(e.y||0).toFixed(1),
       old:(e.old||'').slice(0,26), text:(e.text||'').slice(0,26), full:(e.full||'').slice(0,26), hscale:e.hscale})),
    boxes: [...document.querySelectorAll('#edLayer .edov')].map(n=>({cls:n.className, x:+parseFloat(n.style.left||0).toFixed(1),
       y:+parseFloat(n.style.top||0).toFixed(1), w:+parseFloat(n.style.width||0).toFixed(1), h:+parseFloat(n.style.height||0).toFixed(1),
       t:(n.textContent||'').slice(0,26)}))
  }))()`);
  console.log('STATE:', JSON.stringify(state, null, 1));
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
