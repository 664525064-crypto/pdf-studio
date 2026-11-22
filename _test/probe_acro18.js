/* 探针18（node）：fields_编辑.pdf 全解析 —— Tr 块 Tf 引用 vs 资源 ToUnicode */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
global.window = global; global.self = global;
const PDFLib = require(path.join(__dirname, '..', 'renderer', 'vendor', 'pdf-lib.min.js'));

(async () => {
  const buf = fs.readFileSync(path.join(__dirname, 'out', 'fields_编辑.pdf'));
  const doc = await PDFLib.PDFDocument.load(buf);
  const pg = doc.getPage(0);
  const pgNode = pg.node;
  const fonts = pgNode.Resources().lookup(PDFLib.PDFName.of('Font'));
  const info = {};
  fonts.entries().forEach(([k, v]) => {
    const f = doc.context.lookup(v);
    const tu = f.get(PDFLib.PDFName.of('ToUnicode'));
    let entries = 'MISSING';
    if (tu) {
      try {
        const s = doc.context.lookup(tu);
        const raw = Buffer.from(s.contents || s.getContents());
        let t;
        try { t = zlib.inflateSync(raw).toString('latin1'); }
        catch (e) { t = raw.toString('latin1'); }
        const m = t.match(/beginbfchar([\s\S]*?)endbfchar/);
        entries = m ? m[1].trim().split('\n').slice(0, 20).map(l => l.trim()).join(' ; ') : 'no bfchar';
      } catch (e) { entries = 'ERR ' + e.message; }
    }
    info[k.asString()] = { base: (f.get(PDFLib.PDFName.of('BaseFont')) || '').toString(), entries };
  });
  console.log('=== 字体资源 ===');
  Object.entries(info).forEach(([k, v]) => {
    console.log(k, '| base:', v.base);
    console.log('   ToUnicode:', v.entries.slice(0, 400));
  });

  // 内容流
  const csObj = doc.context.lookup(pgNode.Contents());
  let streams = [];
  if (csObj instanceof PDFLib.PDFArray) {
    for (let i = 0; i < csObj.size(); i++) { const s = doc.context.lookup(csObj.get(i)); streams.push(Buffer.from(s.contents || s.getContents())); }
  } else streams = [Buffer.from(csObj.contents || csObj.getContents())];
  const parts = streams.map((b, i) => {
    try { return zlib.inflateSync(b).toString('latin1'); }
    catch (e) { return b.toString('latin1'); }
  });
  const txt = parts.join('\n');
  console.log('streams:', streams.length, 'sizes:', streams.map(b => b.length).join(','));
  const iTr = txt.indexOf('2 Tr');
  console.log('\n=== 2 Tr 前后 400 字节 ===');
  if (iTr >= 0) console.log(txt.slice(Math.max(0, iTr - 300), iTr + 150));
  else console.log('(无 2 Tr)');
})().catch(e => { console.error('ERR', e); process.exit(1); });
