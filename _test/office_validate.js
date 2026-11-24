/* Office 导出「真实打开验证」：用 python-docx / openpyxl 实际解析应用产出的 docx / xlsx，
   而不只是检查 zip 魔数。运行：dev(9234) 起来后 CDP_PORT=9234 node office_validate.js */
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');

const OUTDIR = path.join(__dirname, '_audit');
const PORT = process.env.CDP_PORT || '9234';
const CORPUS = fs.existsSync(path.join(__dirname, 'policy_p1.pdf'))
  ? path.join(__dirname, 'policy_p1.pdf')
  : path.join(OUTDIR, 'A_center.pdf');
const PY = process.env.PY || 'C:\\Users\\Administrator\\.workbuddy\\binaries\\python\\envs\\default\\Scripts\\python.exe';

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

/* 从页面取 __PS_SAVED__[0].bytes（分块 base64）写盘 */
async function saveFirst(ev, file) {
  const n = await ev(`(function(){ const b=__PS_SAVED__[0].bytes; const CH=0x8000,a=[];
    for(let o=0;o<b.length;o+=CH) a.push(btoa(String.fromCharCode.apply(null,b.subarray(o,o+CH))));
    window.__CH=a; return a.length; })()`);
  let buf = Buffer.alloc(0);
  for (let i = 0; i < n; i++) {
    const p = await ev(`window.__CH[${i}]`);
    buf = Buffer.concat([buf, Buffer.from(p, 'base64')]);
  }
  fs.writeFileSync(file, buf);
  return buf.length;
}

/* node 端 pdf.js 提取语料文字行（作为期望值） */
function corpusRows(file) {
  globalThis.DOMMatrix = class { constructor() { this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0; } };
  globalThis.Path2D = class { moveTo() {} lineTo() {} bezierCurveTo() {} arc() {} rect() {} closePath() {} };
  globalThis.ImageData = class { constructor(a, b, c) { this.data = a; this.width = b; this.height = c; } };
  const pdfjs = require(path.join(__dirname, '..', 'renderer', 'vendor', 'pdf.min.js'));
  globalThis.pdfjsWorker = require(path.join(__dirname, '..', 'renderer', 'vendor', 'pdf.worker.min.js'));
  return pdfjs.getDocument({
    data: new Uint8Array(fs.readFileSync(file)),
    cMapUrl: path.join(__dirname, '..', 'renderer', 'vendor', 'cmaps') + path.sep, cMapPacked: true,
    standardFontDataUrl: path.join(__dirname, '..', 'renderer', 'vendor', 'standard_fonts') + path.sep
  }).promise.then(async doc => {
    const pg = await doc.getPage(1);
    const tc = await pg.getTextContent();
    const rows = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5] * 10) / 10;
      let row = rows.find(r => Math.abs(r.y - y) < 1.2);
      if (!row) { row = { y, text: '' }; rows.push(row); }
      row.text += it.str;
    }
    // 取最长的 6 行作为期望文本（跳过纯数字/空格行）
    return rows.map(r => r.text.trim()).filter(t => /[\u4e00-\u9fa5]/.test(t))
      .sort((a, b) => b.length - a.length).slice(0, 6);
  });
}

(async () => {
  const expected = await corpusRows(CORPUS);
  console.log('期望文本行（前 6）:', JSON.stringify(expected.map(t => t.slice(0, 20))));
  const { ev } = await connect();
  await ev(`window.__E2E__ = 1; 'ok'`); // 桥接保存镜像到 __PS_SAVED__ 供断言

  const runExport = async (tool, optsExpr) => {
    await ev(`__PS_SAVED__.length=0; (async()=>{ await __PS.testOpenDoc('policy.pdf','${fs.readFileSync(CORPUS).toString('base64')}');
      __PS.selectTool('${tool}'); ${optsExpr || ''} await __PS.testRun(); })()`, 180000);
  };

  const results = [];
  const check = (name, cond, extra) => {
    results.push(cond);
    console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
  };

  // 1. 文字模式 docx
  await runExport('p2docx');
  let sz = await saveFirst(ev, path.join(OUTDIR, 'val.docx'));
  check('生成 val.docx', sz > 5000, sz + ' B');

  // 2. 文字模式 xlsx
  await runExport('p2xlsx');
  sz = await saveFirst(ev, path.join(OUTDIR, 'val.xlsx'));
  check('生成 val.xlsx', sz > 3000, sz + ' B');

  // 3. 图片模式 docx
  await runExport('p2docx', `document.getElementById('f_dmode').value='img';`);
  sz = await saveFirst(ev, path.join(OUTDIR, 'val_img.docx'));
  check('生成 val_img.docx（图片模式）', sz > 20000, sz + ' B');
  await ev(`document.getElementById('f_dmode').value='auto';`);

  // 4. python 真实打开验证
  const pyScript = path.join(OUTDIR, '_val_check.py');
  fs.writeFileSync(pyScript, `
import json, sys, zipfile
from docx import Document
import openpyxl
d = ${JSON.stringify(OUTDIR.replace(/\\\\/g, '/'))}
exp = json.load(open(sys.argv[1], encoding='utf-8'))
res = {}
for f in ['val.docx', 'val.xlsx', 'val_img.docx']:
    z = zipfile.ZipFile(d + '/' + f)
    res[f + '_zip'] = z.testzip() is None and len(z.namelist()) > 1
doc = Document(d + '/val.docx')
text = '\\n'.join(p.text for p in doc.paragraphs)
res['docx_hits'] = [e for e in exp if e in text]
res['docx_paras'] = len(doc.paragraphs)
wb = openpyxl.load_workbook(d + '/val.xlsx')
cells = [str(c.value) for row in wb.active.iter_rows() for c in row if c.value is not None]
res['xlsx_sheets'] = wb.sheetnames
res['xlsx_hits'] = [e for e in exp if any(e in c for c in cells)]
res['xlsx_cells'] = len(cells)
d2 = Document(d + '/val_img.docx')
res['imgdocx_shapes'] = len(d2.inline_shapes)
print(json.dumps(res, ensure_ascii=False))
`);
  fs.writeFileSync(path.join(OUTDIR, '_val_expect.json'), JSON.stringify(expected));
  const py = spawnSync(PY, [pyScript, path.join(OUTDIR, '_val_expect.json')], { encoding: 'utf8', timeout: 120000 });
  if (py.status !== 0) {
    check('python 解析执行', false, (py.stderr || py.stdout || 'no output').slice(0, 400));
  } else {
    const r = JSON.parse(py.stdout.trim().split('\n').pop());
    check('docx zip 完整性（CRC）', r['val.docx_zip'] === true, JSON.stringify({ zip: r['val.docx_zip'], xzip: r['val.xlsx_zip'], izip: r['val_img.docx_zip'] }));
    check('xlsx zip 完整性（CRC）', r['val.xlsx_zip'] === true, '');
    check('docx 文字命中 ≥3 行', r.docx_hits.length >= 3, '命中 ' + r.docx_hits.length + '/' + expected.length + ' 段落 ' + r.docx_paras);
    check('xlsx 文字命中 ≥3 行', r.xlsx_hits.length >= 3, '命中 ' + r.xlsx_hits.length + ' 单元格 ' + r.xlsx_cells + ' 表 ' + JSON.stringify(r.xlsx_sheets));
    check('图片版 docx 嵌入页面图', r['val_img.docx_zip'] === true && r.imgdocx_shapes >= 1, 'shapes=' + r.imgdocx_shapes);
  }

  const fails = results.filter(x => !x).length;
  console.log(`\n==== 结果: ${results.length - fails}/${results.length} 通过 ====`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
