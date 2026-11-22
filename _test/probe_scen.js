/* 场景矩阵：找出「同一行出现两个框」的触发路径 */
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
    if (m.result.exceptionDetails) return 'EXC:' + JSON.stringify(m.result.exceptionDetails).slice(0, 400);
    return m.result.result.value;
  };

  const HELP = `
    window.__t = {
      idx(kw){ return ED.lines.findIndex(function(L){return (L.text||'').indexOf(kw)>=0}); },
      async clickEdit(i, fn){
        var tl=document.querySelector('.tline[data-i="'+i+'"]'); if(!tl) return 'no tline';
        tl.click();
        var box=null; for(var k=0;k<40 && !(box=document.querySelector('.edin'));k++) await new Promise(r=>setTimeout(r,120));
        if(!box) return 'no box';
        box.focus(); var nt=fn(ED.lines[i].text); box.textContent=nt;
        box.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
        await new Promise(r=>setTimeout(r,250)); return 'ok';
      },
      boxes(){ return [...document.querySelectorAll('#edLayer .edov')].map(function(n){
        return {x:+parseFloat(n.style.left).toFixed(1), w:+parseFloat(n.style.width).toFixed(1), y:+parseFloat(n.style.top).toFixed(1), t:(n.textContent||'').slice(0,22)}; }); },
      recs(){ return ED.edits.map(function(e){ return {suffix:!!e.suffix, multi:!!e.multi, x:+e.x.toFixed(1), w:+e.w.toFixed(1), y:+e.y.toFixed(1), full:(e.full||'').slice(0,30), t:(e.text||'').slice(0,22)}; }); }
    };`;

  console.log('boot:', await ev(`(async()=>{ await __PS.testOpenDoc('policy_p1.pdf','${b64}'); await new Promise(r=>setTimeout(r,1200)); await __PS.openEditor(0); await new Promise(r=>setTimeout(r,1500)); ${HELP} return ED.lines.length; })()`, 180000));

  const run = async (name, expr) => {
    const out = await ev(`(async()=>{ ED.edits=[]; ED.regions=[]; ED.news=[]; await new Promise(r=>setTimeout(r,150)); ${expr} })()`, 90000);
    console.log('== ' + name + ' ==', JSON.stringify(out));
  };

  // A: 同一行连续改两次（第二次改后半段）
  await run('A 同行改两次', `
    var i=__t.idx('保险期间');
    await __t.clickEdit(i, function(t){return t.replace('09月09','09月08')});
    await __t.clickEdit(i, function(t){return t.replace('零时起','零时正')});
    return {recs:__t.recs(), boxes:__t.boxes()};`);

  // B: 先单行改，再用查找替换改同一行
  await run('B 单行改 + 查找替换', `
    var i=__t.idx('总保险金额');
    await __t.clickEdit(i, function(t){return t.replace('叁伯','叁佰')});
    document.getElementById('edFind').value='拥';
    document.getElementById('edRepl').value='捌';
    await edBatchReplace();
    await new Promise(r=>setTimeout(r,400));
    return {recs:__t.recs(), boxes:__t.boxes()};`);

  // C: 两次查找替换（同一行两次命中）
  await run('C 两次查找替换', `
    document.getElementById('edFind').value='叁伯'; document.getElementById('edRepl').value='叁佰';
    await edBatchReplace(); await new Promise(r=>setTimeout(r,300));
    document.getElementById('edFind').value='拥'; document.getElementById('edRepl').value='捌';
    await edBatchReplace(); await new Promise(r=>setTimeout(r,300));
    return {recs:__t.recs(), boxes:__t.boxes()};`);

  // D: 改一行 → 撤销 → 再改（撤销后记录残留？）
  await run('D 改→撤销→再改', `
    var i=__t.idx('被保险人');
    await __t.clickEdit(i, function(t){return t.replace('安润','安泰')});
    var u=document.getElementById('edUndo'); if(u) u.click();
    await new Promise(r=>setTimeout(r,300));
    await __t.clickEdit(i, function(t){return t.replace('泰州市','泰州是')});
    return {recs:__t.recs(), boxes:__t.boxes()};`);

  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
