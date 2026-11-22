/* 截图：Acrobat 式界面（编辑态 + 格式面板 + 插入内容） */
const fs = require('fs');
const path = require('path');
(async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0; const pend = new Map();
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (method, params, timeout = 12000) => new Promise((res, rej) => {
    const id = ++seq; pend.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pend.has(id)) { pend.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async x => {
    const m = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true, userGesture: true });
    if (m.result.exceptionDetails) throw new Error(String(JSON.stringify(m.result.exceptionDetails)).slice(0, 300));
    return m.result.result.value;
  };
  const shot = async name => {
    for (let i = 0; i < 12; i++) {
      try {
        try { await send('Page.bringToFront', {}, 5000); } catch (e) {}
        const m = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90, fromSurface: i % 2 === 0 }, 8000);
        if (m && m.result && m.result.data) { fs.writeFileSync(path.join(__dirname, name), Buffer.from(m.result.data, 'base64')); console.log('saved', name); return true; }
      } catch (e) { }
      await new Promise(r => setTimeout(r, 1200));
    }
    console.log('FAILED', name); return false;
  };

  await new Promise(r => setTimeout(r, 1200));
  await shot('shot0_home.png');

  const bA = fs.readFileSync(path.join(__dirname, 'test-a.pdf')).toString('base64');
  await ev(`(async()=>{ await __PS.testOpenDoc('test-a.pdf','${bA}'); await __PS.openEditor(0); })()`);
  await new Promise(r => setTimeout(r, 1400));

  // 点一行进入编辑 → 右侧「格式」出现
  const st = await ev(`(async()=>{
    document.getElementById('edFind').value='';
    document.getElementById('edRepl').value='';
    const i=ED.lines.findIndex(l=>l.items && l.items.map(x=>String(x.str||'')).join('').trim().length>=6);
    if(i<0) return 'no line';
    edStartEdit(i);
    await new Promise(r2=>setTimeout(r2,700));
    const bx=document.querySelector('.edin');
    if(bx){ const sel=getSelection(); const rg=document.createRange(); rg.selectNodeContents(bx); rg.collapse(false); sel.removeAllRanges(); sel.addRange(rg); }
    const f=document.getElementById('edFmt');
    return {lines:ED.lines.length, fmt:f?getComputedStyle(f).display:'none', inline:!!ED.inline};
  })()`);
  console.log('state:', JSON.stringify(st));
  await new Promise(r => setTimeout(r, 600));
  await shot('shot4_acrobat_edit.png');

  // 再显示插入文本 + 图片的完整状态
  const b64 = fs.readFileSync(path.join(__dirname, 'img1.png')).toString('base64');
  await ev(`(async()=>{
    if(ED.inline) edCommitInline();
    const bin=Uint8Array.from(atob('${b64}'),c=>c.charCodeAt(0));
    ED.news.push({page:ED.page,nwId:'n1',x:100,y:740,size:14,color:'#1e6fd9',fam:'song',text:'新增备注：本单一经签收即视为送达',w:250,lh:1.5,bold:true,italic:false,align:'left'});
    ED.regions.push({page:ED.page,img:bin,x:120,y:560,w:135,h:90});
    edPaintOverlays(); edSyncSide();
    return 'ok';
  })()`);
  await new Promise(r => setTimeout(r, 800));
  await shot('shot5_acrobat_full.png');
  ws.close(); process.exit(0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
