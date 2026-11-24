/* 保真全量审计：6 份文档 × 程序化编辑 → 保存 → 输出断言
   运行：先启动 dev（9234），CDP_PORT=9234 node audit_fidelity.js */
const path = require('path');
const fs = require('fs');

const OUTDIR = path.join(__dirname, '_audit');
const PORT = process.env.CDP_PORT || '9234';
const POLICY = 'C:\\Users\\Administrator\\Desktop\\苏M34412-2026年工程机械保单.pdf';

/* ---------- CDP 辅助 ---------- */
async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params, timeout = 30000) => new Promise((res, rej) => {
    const id = ++seq; pending.set(id, m => m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result));
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error('timeout ' + method)); } }, timeout);
  });
  const ev = async (expr, timeout) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, timeout || 30000);
    if (r.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails).slice(0, 500));
    return r.result.value;
  };
  return { ws, send, ev };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- PDF 文字层几何提取（node 端，pdf.js） ---------- */
function loadPdfjs() {
  globalThis.DOMMatrix = class DOMMatrix { constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; } };
  globalThis.Path2D = class Path2D { moveTo() {} lineTo() {} bezierCurveTo() {} arc() {} rect() {} closePath() {} };
  globalThis.ImageData = class ImageData { constructor(a, b, c) { this.data = a; this.width = b; this.height = c; } };
  const pdfjs = require(path.join(__dirname, '..', 'renderer', 'vendor', 'pdf.min.js'));
  globalThis.pdfjsWorker = require(path.join(__dirname, '..', 'renderer', 'vendor', 'pdf.worker.min.js'));
  return pdfjs;
}
async function extractGeometry(file, pdfjs) {
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjs.getDocument({ data, cMapUrl: path.join(__dirname, '..', 'renderer', 'vendor', 'cmaps') + path.sep, cMapPacked: true, standardFontDataUrl: path.join(__dirname, '..', 'renderer', 'vendor', 'standard_fonts') + path.sep }).promise;
  const pg = await doc.getPage(1);
  const tc = await pg.getTextContent();
  // 按 y 聚合成行
  const rows = [];
  for (const it of tc.items) {
    if (!it.str) continue;
    const x = it.transform[4], y = Math.round(it.transform[5] * 10) / 10;
    let row = rows.find(r => Math.abs(r.y - y) < 1.2);
    if (!row) { row = { y, items: [] }; rows.push(row); }
    row.items.push({ str: it.str, x, x1: x + it.width, w: it.width });
  }
  rows.forEach(r => {
    r.text = r.items.map(i => i.str).join('');
    r.x0 = Math.min(...r.items.map(i => i.x));
    r.x1 = Math.max(...r.items.map(i => i.x1));
  });
  // 字体资源 BaseFont
  const { PDFDocument } = require(path.join(__dirname, '..', 'renderer', 'vendor', 'pdf-lib.min.js'));
  let fonts = [];
  try {
    const d = await PDFDocument.load(data, { ignoreEncryption: true });
    const pgd = d.getPages()[0];
    const res = pgd.node.Resources();
    const PN = d.context.obj('Font').constructor === Object ? null : null;
    const fontsDict = res && res.get && res.lookup ? null : null;
    // 简化：遍历 dict
    const fd = res && res.dict ? res.dict : res;
    if (fd && fd.entries) {
      for (const [k, v] of fd.entries()) {
        if (k.asString && k.asString() === 'Font') {
          const sub = d.context.lookup(v);
          for (const [k2, v2] of sub.entries()) {
            const fo = d.context.lookup(v2);
            const bf = fo && fo.get ? fo.get(d.context.obj('BaseFont')) : null;
            if (bf) fonts.push(typeof bf === 'object' && bf.asString ? bf.asString() : String(bf));
          }
        }
      }
    }
  } catch (e) { /* 字体枚举失败不阻断 */ }
  return { rows: rows.sort((a, b) => b.y - a.y), fonts };
}
const findRow = (geo, sub) => geo.rows.filter(r => r.text.includes(sub));
const rowOf = (geo, sub) => findRow(geo, sub)[0] || null;

/* ---------- 审计计划 ---------- */
const PLANS = [
  {
    tag: 'A_center', file: path.join(OUTDIR, 'A_center.pdf'), via: 'b64',
    edit: { type: 'para', match: '机动车辆商业保险单', text: '2026年机动车辆商业保险单\n（电子保单）' },
    checks: async (orig, out, meta) => {
      const r = [];
      const o1 = rowOf(orig, '机动车辆商业保险单'), o2 = rowOf(orig, '（电子保单）');
      const n1 = rowOf(out, '2026年机动车辆商业保险单'), n2 = rowOf(out, '（电子保单）');
      r.push(['A1 标题第一行含插入文字', !!n1]);
      r.push(['A2 标题仍为两行', n1 && n2 && Math.abs(n1.y - n2.y) > 8 && findRow(out, '（电子保单）').length === 1]);
      const c1 = n1 ? (n1.x0 + n1.x1) / 2 : null, c2 = n2 ? (n2.x0 + n2.x1) / 2 : null;
      const oc1 = o1 ? (o1.x0 + o1.x1) / 2 : null;
      r.push(['A3 两行中心一致(±2.5)', c1 != null && c2 != null && Math.abs(c1 - c2) < 2.5]);
      r.push(['A4 与原版中心一致(±3)', oc1 != null && c1 != null && Math.abs(c1 - oc1) < 3]);
      r.push(['A5 页面检测 align=center', meta.align === 'center']);
      return r;
    },
  },
  {
    tag: 'B_right', file: path.join(OUTDIR, 'B_right.pdf'), via: 'b64',
    edit: { type: 'para', match: '兹证明该车已于本月办理停驶手续', text: '兹证明该车已于本月提前办理停驶手续，\n停驶期间发生的交通事故与本公司无关，\n请车主妥善保管本告知书以备查验。' },
    checks: async (orig, out, meta) => {
      const r = [];
      const o1 = rowOf(orig, '兹证明该车');
      const n1 = rowOf(out, '提前办理停驶手续');
      r.push(['B1 第一行已改', !!n1]);
      r.push(['B2 右缘与原版一致(±3)', o1 && n1 && Math.abs(n1.x1 - o1.x1) < 3]);
      r.push(['B3 页面检测 align=right', meta.align === 'right']);
      const s1 = rowOf(out, '某某财产保险股份有限公司'), s0 = rowOf(orig, '某某财产保险股份有限公司');
      r.push(['B4 落款右缘/缩进未动(±1.5, 允许重排下移)', s1 && s0 && Math.abs(s1.x1 - s0.x1) < 1.5 && Math.abs(s1.x0 - s0.x0) < 1.5 && Math.abs(s1.y - s0.y) < 30]);
      return r;
    },
  },
  {
    tag: 'C_table', file: path.join(OUTDIR, 'C_table.pdf'), via: 'b64',
    edit: { type: 'para', match: '徐工XCT8', text: '徐工XCT8-改进型' },
    checks: async (orig, out, meta) => {
      const r = [];
      const oC = rowOf(orig, '徐工XCT8'), nC = rowOf(out, '徐工XCT8-改进型');
      r.push(['C1 单元格已改', !!nC]);
      r.push(['C2 行 y 不变(±1.5)', oC && nC && Math.abs(nC.y - oC.y) < 1.5]);
      const oM = rowOf(orig, '苏M34412'), nM = rowOf(out, '苏M34412');
      r.push(['C3 同行其他列 x 不动(±1.5)', oM && nM && Math.abs(nM.x0 - oM.x0) < 1.5 && Math.abs(nM.y - oM.y) < 1.5]);
      const oN = rowOf(orig, '苏N77881'), nN = rowOf(out, '苏N77881');
      r.push(['C4 下一行表格未被挤动', oN && nN && Math.abs(nN.y - oN.y) < 1.5]);
      const oNote = rowOf(orig, '备注：以上车辆均投保'), nNote = rowOf(out, '备注：以上车辆均投保');
      r.push(['C5 表下备注未动', oNote && nNote && Math.abs(nNote.y - oNote.y) < 1.5]);
      return r;
    },
  },
  {
    tag: 'D_mixfont', file: path.join(OUTDIR, 'D_mixfont.pdf'), via: 'b64',
    edit: { type: 'suffix', match: '特别约定：', add: '补充说明' },
    checks: async (orig, out, meta) => {
      const r = [];
      const o1 = rowOf(orig, '特别约定：'), n1 = rowOf(out, '补充说明');
      r.push(['D1 追加文字在行尾', !!n1 && n1.text.includes('补充说明')]);
      r.push(['D2 追加后行右缘外延', o1 && n1 && n1.x1 > o1.x1 - 0.5]);
      const o2 = rowOf(orig, '投保人声明'), n2 = rowOf(out, '投保人声明');
      r.push(['D3 其他行未动', o2 && n2 && Math.abs(n2.x0 - o2.x0) < 1.5 && Math.abs(n2.y - o2.y) < 1.5]);
      r.push(['D4 输出嵌入衬线字体', out.fonts.some(f => /KaiTi|SimSun|FangSong|SimHei/i.test(String(f)))]);
      return r;
    },
  },
  {
    tag: 'E_bold', file: path.join(OUTDIR, 'E_bold.pdf'), via: 'b64',
    edit: { type: 'para', match: '保险单正本、事故证明、维修发票', text: '保险单正本、事故证明、维修收据、驾驶证复印件。' },
    checks: async (orig, out, meta) => {
      const r = [];
      const o1 = rowOf(orig, '保险单正本、事故证明'), n1 = rowOf(out, '维修收据');
      r.push(['E1 加粗行已改', !!n1]);
      r.push(['E2 行 y 不变', o1 && n1 && Math.abs(n1.y - o1.y) < 1.5]);
      r.push(['E3 仍是单行', findRow(out, '保险单正本').length === 1]);
      r.push(['E4 行级字体=黑体', meta.fam === 'hei']);
      r.push(['E5 输出嵌入黑体', out.fonts.some(f => /SimHei/i.test(String(f)))]);
      const o2 = rowOf(orig, '未按要求提供完整材料'), n2 = rowOf(out, '未按要求提供完整材料');
      r.push(['E6 下方行未动', o2 && n2 && Math.abs(n2.y - o2.y) < 1.5]);
      const o0 = rowOf(orig, '被保险人索赔时应提供'), n0 = rowOf(out, '被保险人索赔时应提供');
      r.push(['E7 上方行未动', o0 && n0 && Math.abs(n0.y - o0.y) < 1.5]);
      return r;
    },
  },
  {
    tag: 'policy', file: POLICY, via: 'file',
    edit: { type: 'paraTitle' },
    checks: async (orig, out, meta) => {
      const r = [];
      const n1 = rowOf(out, '（验）');
      r.push(['P1 标题含追加文字', !!n1]);
      const o1 = rowOf(orig, '中国人民财产保险股份'), o2 = rowOf(orig, '起重机械财产损失保险保险单');
      r.push(['P2 页面检测 align=center', meta.align === 'center']);
      r.push(['P3 页面检测黑体', /SimHei/i.test(meta.srcFont || '')]);
      const n2 = rowOf(out, '起重机械财产损失保险保险单');
      if (o1 && n1) r.push(['P4 行1中心保持(±3)', Math.abs((n1.x0 + n1.x1) / 2 - (o1.x0 + o1.x1) / 2) < 3]);
      if (o2 && n2) r.push(['P5 行2中心保持(±3)', Math.abs((n2.x0 + n2.x1) / 2 - (o2.x0 + o2.x1) / 2) < 3]);
      r.push(['P6 输出嵌入黑体', out.fonts.some(f => /SimHei/i.test(String(f)))]);
      return r;
    },
  },
];

/* ---------- 页面侧编辑代码 ---------- */
const JS_OPEN = `(async()=>{ __PS.selectTool('edittext'); __PS.testResetEdits(); await __PS.openEditor(0); return ED.open; })()`;
const JS_META = (kind, match, newText) => `(async()=>{
  const hit = ED.lines.map((l,i)=>({i,l})).filter(o=>(o.l.text||'').includes(${JSON.stringify(match)}));
  ${kind === 'paraTitle' ? `
  const heiLines = ED.lines.map((l,i)=>({i,l})).filter(o=>/SimHei/i.test(o.l.srcFont||''));
  if(!heiLines.length) return {ok:false, why:'no SimHei line'};
  const idx = heiLines[0].i;
  const pi = ED.paraOf[idx];
  const P = edParaInfo(pi);
  if(!P) return {ok:false, why:'no para'};
  const ls = P.lines.map(l=>l.text);
  const newText = ls[0] + '（验）' + '\\n' + ls.slice(1).join('\\n');
  const ok = edApplyParaText(pi, newText);
  return {ok, align:P.align, x0:P.x0, x1:P.x1, n:P.n, size:P.size, srcFont:P.lines[0].srcFont||null, bold:!!P.lines[0].bold, fam:edFam(P.lines[0]),
          rowC:P.lines.map(l=>l.x+(((l.x2!=null)?l.x2:l.x+(l.w||0))-l.x)/2)};
  ` : kind === 'para' ? `
  if(!hit.length) return {ok:false, why:'line not found'};
  const pi = ED.paraOf[hit[0].i];
  const P = edParaInfo(pi);
  if(!P) return {ok:false, why:'no para'};
  const ok = edApplyParaText(pi, ${JSON.stringify(newText)});
  return {ok, align:P.align, x0:P.x0, x1:P.x1, n:P.n, size:P.size, srcFont:P.lines[0].srcFont||null, bold:!!P.lines[0].bold, fam:edFam(P.lines[0])};
  ` : `
  const L = ED.lines.find(l=>(l.text||'').includes(${JSON.stringify(match)}));
  if(!L) return {ok:false, why:'line not found'};
  const rec = { page:ED.page, suffix:true, x:L.x2, w:200, y:L.y, h:L.size,
                old:'', text:${JSON.stringify(newText)}, full:L.text+${JSON.stringify(newText)}, oldFull:L.text,
                color:edPenColor(L), size:L.size, inkH:L.inkH||null, ocr:!!L.ocr,
                bg:L.ocr?edBgSample(edBox(L)):null, fam:edFam(L), hscale:1,
                autoFam:false, autoSize:false, bold:!!L.bold, italic:false, align:null };
  edDropLineRecs(L); ED.edits.push(rec);
  return {ok:true, align:null, srcFont:L.srcFont||null, bold:!!L.bold, fam:rec.fam};
  `}
})()`;
const JS_SAVE = `(async()=>{
  const b = await edSaveEdits();
  if(!b || !b.length) return null;
  window.__AUD = b;
  const CH=0x8000, chunks=[];
  for(let o=0;o<b.length;o+=CH) chunks.push(btoa(String.fromCharCode.apply(null, b.subarray(o,o+CH))));
  window.__AUD_CH = chunks;
  return {len:b.length, n:chunks.length};
})()`;

/* ---------- 主流程 ---------- */
(async () => {
  const pdfjs = loadPdfjs();
  const { ev, send } = await connect();
  await send('Page.enable'); await send('DOM.enable'); await send('Runtime.enable');
  await ev(`window.__E2E__=1`);

  const results = [];
  for (const plan of PLANS) {
    const line = (s) => process.stdout.write(s + '\n');
    line('==== ' + plan.tag + ' ====');
    try {
      // 打开文档
      if (plan.via === 'b64') {
        const b64 = fs.readFileSync(plan.file).toString('base64');
        await ev(`__PS.testOpenDoc(${JSON.stringify(path.basename(plan.file))}, '${b64}')`, 120000);
      } else {
        const doc = await send('DOM.getDocument', {});
        const q = await send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#fopen' });
        await send('DOM.setFileInputFiles', { files: [plan.file], nodeId: q.nodeId });
        await ev(`document.getElementById('fopen').dispatchEvent(new Event('change'))`);
      }
      let pages = 0;
      for (let i = 0; i < 90; i++) {
        await sleep(1000);
        pages = await ev(`document.querySelectorAll('.pcell').length`).catch(() => 0);
        if (pages >= 1) break;
      }
      await ev(JS_OPEN, 180000);
      await sleep(3000);

      // 原版基准
      const orig = await extractGeometry(plan.file, pdfjs);

      // 编辑
      const meta = await ev(JS_META(plan.edit.type, plan.edit.match || '', plan.edit.text || plan.edit.add || ''), 60000);
      line('META: ' + JSON.stringify(meta));
      if (!meta || meta.ok !== true) throw new Error('edit failed: ' + JSON.stringify(meta));

      // 保存 + 回传
      await ev(`__PS_SAVED__.length=0`);
      const sv = await ev(JS_SAVE, 300000);
      if (!sv) throw new Error('save returned null');
      let buf = Buffer.alloc(0);
      for (let i = 0; i < sv.n; i++) {
        const p = await ev(`window.__AUD_CH[${i}]`);
        buf = Buffer.concat([buf, Buffer.from(p, 'base64')]);
      }
      const outFile = path.join(OUTDIR, 'out_' + plan.tag + '.pdf');
      fs.writeFileSync(outFile, buf);
      line('SAVED: ' + buf.length + ' bytes');
      await ev(`window.__AUD=null; window.__AUD_CH=null`);

      // 输出断言（字体枚举走页面端 PDFLib，node 端枚举不可靠）
      const fontsPage = await ev(`(async()=>{
        const b=(__PS_SAVED__[__PS_SAVED__.length-1]||{}).bytes; if(!b) return [];
        const doc=await PDFLib_.PDFDocument.load(b.slice());
        const page=doc.getPages()[0];
        const res=page.node.Resources(); if(!res) return [];
        const PN=PDFLib_.PDFName, PD=PDFLib_.PDFDict;
        const fonts=res.lookup(PN.of('Font'), PD);
        const out=[];
        if(fonts) for(const [,v] of fonts.entries()){
          const d=doc.context.lookup(v); let nm='';
          try{ const bf=d.get(PN.of('BaseFont')); if(bf) nm=bf.asString?bf.asString():String(bf); }catch(e){}
          out.push(nm);
        }
        return out;
      })()`, 180000);
      const out = await extractGeometry(outFile, pdfjs);
      out.fonts = fontsPage && fontsPage.length ? fontsPage : out.fonts;
      line('OUT FONTS: ' + JSON.stringify(out.fonts));
      const checks = await plan.checks(orig, out, meta);
      let fail = 0;
      for (const [name, ok] of checks) { line((ok ? 'PASS' : 'FAIL') + ' ' + name); if (!ok) fail++; }
      results.push({ tag: plan.tag, total: checks.length, fail });
    } catch (e) {
      line('ERROR ' + plan.tag + ': ' + e.message);
      results.push({ tag: plan.tag, error: e.message });
    }
  }

  console.log('\n======== SUMMARY ========');
  let tf = 0;
  for (const r of results) {
    if (r.error) { console.log(r.tag + ': ERROR ' + r.error); tf++; }
    else { console.log(r.tag + ': ' + (r.total - r.fail) + '/' + r.total + (r.fail ? '  FAIL=' + r.fail : '')); tf += r.fail; }
  }
  console.log(tf === 0 ? 'ALL GREEN' : 'TOTAL FAIL: ' + tf);
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
