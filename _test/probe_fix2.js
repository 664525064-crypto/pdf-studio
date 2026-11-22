/* 截图：编辑「保险期间」插入 555555 后，应用内的预览层长什么样 */
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

  console.log('open:', await ev(`(async()=>{ await __PS.testOpenDoc('policy_p1.pdf','${b64}'); await new Promise(r=>setTimeout(r,1200)); await __PS.openEditor(0); await new Promise(r=>setTimeout(r,1500)); __PS.testResetEdits(); return 1; })()`, 180000));
  console.log('edit:', JSON.stringify(await ev(`(async()=>{
    var i=ED.lines.findIndex(function(L){return (L.text||'').indexOf('保险期间：')===0});
    edStartEdit(i);
    var box=null; for(var k=0;k<30 && !(box=document.querySelector('.edin'));k++) await new Promise(r=>setTimeout(r,150));
    if(!box) return {err:'no box'};
    box.focus(); box.textContent=ED.lines[i].text.replace('零时起，','零时起，555555');
    edCommitInline();
    await new Promise(r=>setTimeout(r,400));
    var ov=document.querySelector('.edov');
    var sp=ov&&ov.querySelector('span');
    return {suffix:!!(ov&&ov.__rec&&ov.__rec.suffix), ovFont:ov?getComputedStyle(ov).fontSize:null,
            tr:sp?sp.style.transform:null, left:ov?ov.style.left:null, w:ov?ov.style.width:null};
  })()`, 90000)));

  // 截图（窗口截图走 CDP，先 bringToFront）
  try { await send('Page.bringToFront', {}, 5000); } catch (e) {}
  const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true }, 20000);
  if (shot.result && shot.result.data) {
    fs.writeFileSync(__dirname + '/preview_shot.png', Buffer.from(shot.result.data, 'base64'));
    console.log('shot ok', shot.result.data.length);
  } else console.log('shot fail', JSON.stringify(shot).slice(0, 200));
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
