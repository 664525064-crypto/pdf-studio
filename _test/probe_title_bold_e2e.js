/* 标题行字体保真端到端：打开保单 → 检查标题行 srcFont/bold/fam → 改字保存 → 验证输出嵌入黑体 */
const path = require('path');
const fs = require('fs');
const POLICY = 'C:\\Users\\Administrator\\Desktop\\苏M34412-2026年工程机械保单.pdf';
const OUT = path.join(__dirname, '_out');

const run = async () => {
  const list = await (await fetch('http://127.0.0.1:9234/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params, timeout = 30000) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, m => m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async (expr, timeout) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, timeout || 30000);
    if (r.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };

  await send('Page.enable'); await send('DOM.enable'); await send('Runtime.enable');

  const doc = await send('DOM.getDocument', {});
  const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#fopen' });
  await send('DOM.setFileInputFiles', { files: [POLICY], nodeId: q.nodeId });
  await ev(`document.getElementById('fopen').dispatchEvent(new Event('change'))`);

  let info = null;
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000));
    info = await ev(`({name: st.name, pages: document.querySelectorAll('.pcell').length})`).catch(() => null);
    if (info && info.pages >= 22) break;
  }
  if (!info || info.pages < 22) throw new Error('doc not loaded');
  console.log('OPEN ok, pages:', info.pages);

  // 开编辑器
  await ev(`(async()=>{ __PS.selectTool('edittext'); __PS.testResetEdits(); await __PS.openEditor(0); return ED.open; })()`, 120000);
  await new Promise(r => setTimeout(r, 2500));

  // 1) 行级字体检测结果
  const det = await ev(`(function(){
    const hit = ED.lines.map((l,i)=>({i, l})).filter(o=>(o.l.text||'').includes('中国人民财产保险股份有限公司'));
    if(!hit.length) return {found:false};
    const L = hit[0].l;
    return {found:true, idx:hit[0].i, text:L.text.slice(0,30), srcFont:L.srcFont||null,
            bold:!!L.bold, fam:edFam(L), pageFam:pageFamily(0), docFam:ED.docFam};
  })()`);
  console.log('DETECT:', JSON.stringify(det));
  if (!det.found) throw new Error('title line not found');
  if (!/SimHei/i.test(det.srcFont || '')) throw new Error('srcFont should be SimHei, got ' + det.srcFont);
  if (det.fam !== 'hei') throw new Error('fam should be hei, got ' + det.fam);

  // 2) 改标题行（行尾追加「（验证）」→ suffix 模式），同时改「保险单号」行验证 SimSun-Bold
  const r1 = await ev(`(function(){
    const idx = ${det.idx};
    const L = ED.lines[idx];
    const rec = { page:ED.page, suffix:true, x:L.x2, w:200, y:L.y, h:L.size,
                  old:'', text:'（验证）', full:L.text+'（验证）', oldFull:L.text,
                  color:edPenColor(L), size:L.size, inkH:L.inkH||null, ocr:false, bg:null,
                  fam:edFam(L), hscale:1, autoFam:false, autoSize:false, bold:!!L.bold, italic:false, align:null };
    edDropLineRecs(L); ED.edits.push(rec);
    // 保险单号行（SimSun-Bold → song+bold）
    const Lb = ED.lines.find(l=>(l.text||'').includes('保险单号'));
    if(Lb){
      const rb = { page:ED.page, suffix:true, x:Lb.x2, w:150, y:Lb.y, h:Lb.size,
                   old:'', text:'X', full:Lb.text+'X', oldFull:Lb.text,
                   color:edPenColor(Lb), size:Lb.size, inkH:Lb.inkH||null, ocr:false, bg:null,
                   fam:edFam(Lb), hscale:1, autoFam:false, autoSize:false, bold:!!Lb.bold, italic:false, align:null };
      edDropLineRecs(Lb); ED.edits.push(rb);
      return {title:${det.idx}, boldLabel:{srcFont:Lb.srcFont, bold:!!Lb.bold, fam:edFam(Lb)}};
    }
    return {title:${det.idx}, boldLabel:null};
  })()`);
  console.log('EDITS:', JSON.stringify(r1));

  // 3) 保存
  const sv = await ev(`(async()=>{ const b = await edSaveEdits();
      return {len: b?b.length:0}; })()`, 180000);
  console.log('SAVE:', JSON.stringify(sv));
  if (!sv || sv.len < 1000000) throw new Error('save failed: ' + JSON.stringify(sv));

  // 4) 输出字体资源检查：应有 SimHei（标题追加字）+ SimSun-Bold 标签行走 fake-bold（同 song 字体）
  const fonts = await ev(`(function(){
    const PN=PDFLib_.PDFName, PD=PDFLib_.PDFDict;
    const d=PDFLib_.PDFDocument.load; return 'n/a';
  })()`).catch(()=>null);
  // 在页面内直接解析刚保存的字节
  const fontRes = await ev(`(async function(){
    const b=__PS_SAVED__[__PS_SAVED__.length-1].bytes;
    const doc=await PDFLib_.PDFDocument.load(b.slice());
    const page=doc.getPages()[0];
    const res=page.node.Resources();
    const PN=PDFLib_.PDFName, PD=PDFLib_.PDFDict;
    const fonts=res.lookup(PN.of('Font'), PD);
    const out=[];
    if(fonts) for(const [k,v] of fonts.entries()){
      const d=doc.context.lookup(v); let nm='';
      try{ const bf=d.get(PN.of('BaseFont')); if(bf) nm=bf.asString?bf.asString():String(bf); }catch(e){}
      out.push(nm);
    }
    return out;
  })()`, 120000);
  console.log('OUT FONTS:', JSON.stringify(fontRes));
  const hasHei = fontRes.some(f=>/SimHei/i.test(f));
  if (!hasHei) throw new Error('output missing SimHei embedded font');
  console.log('PASS: output embeds SimHei for title');

  // 5) 画布截图（改字后 WYSIWYG）
  await ev(`edPaintLayer()`);
  await new Promise(r => setTimeout(r, 500));
  const shot = await ev(`(function(){ return edCanvas.toDataURL('image/png'); })()`, 60000);
  fs.writeFileSync(path.join(OUT, 'policy_title_bold.png'), Buffer.from(shot.split(',')[1], 'base64'));
  console.log('SCREENSHOT saved');
  process.exit(0);
};
run().catch(e => { console.error('FATAL', e.message); process.exit(1); });
