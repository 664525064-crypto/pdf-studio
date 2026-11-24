/* 生成浅灰网格表格语料（tesseract 对重黑网格会拒识整块区域） */
const path = require('path');
const fs = require('fs');
const { PDFDocument, rgb, StandardFonts } = require(path.join(__dirname, '..', 'renderer', 'vendor', 'pdf-lib.min.js'));
const fontkit = require(path.join(__dirname, '..', 'renderer', 'vendor', 'fontkit.umd.min.js'));

(async () => {
  const FDIR = 'C:\\Windows\\Fonts';
  const song = fs.readFileSync(path.join(FDIR, 'simkai.ttf'));
  const hei = fs.readFileSync(path.join(FDIR, 'simhei.ttf'));
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.registerFontkit(fontkit);
  const fSong = await doc.embedFont(song, { subset: true });
  const fHei = await doc.embedFont(hei, { subset: true });
  const textW = (f, s, t) => f.widthOfTextAtSize(t, s);
  const pg = doc.addPage([595.28, 841.89]);
  const W = 595.28;
  const t = '车辆信息登记表';
  pg.drawText(t, { x: (W - textW(fHei, 16, t)) / 2, y: 770, size: 16, font: fHei });
  const cols = [60, 200, 320, 470];
  const rows = [
    ['车牌号码', '厂牌型号', '发动机号', '使用性质'],
    ['苏M34412', '徐工XCT8', 'WP1024567', '营业货运'],
    ['苏N77881', '三一STC25', 'SQ5543210', '营业货运'],
    ['苏B12093', '中联ZLJ52', 'ZLJ8890231', '非营业'],
    ['苏J66302', '柳工TC75', 'LG6678123', '非营业'],
  ];
  const yTop = 730, rowH = 26, colW = [140, 120, 150, 80];
  const gray = rgb(0.72, 0.72, 0.72);
  const nR = rows.length;
  for (let i = 0; i <= nR; i++)
    pg.drawLine({ start: { x: cols[0], y: yTop - i * rowH }, end: { x: cols[3] + colW[3], y: yTop - i * rowH }, thickness: 0.5, color: gray });
  for (let c = 0; c <= 4; c++) {
    const xx = c < 4 ? cols[c] : cols[3] + colW[3];
    pg.drawLine({ start: { x: xx, y: yTop }, end: { x: xx, y: yTop - nR * rowH }, thickness: 0.5, color: gray });
  }
  rows.forEach((r, ri) => {
    r.forEach((cell, ci) => {
      const f = ri === 0 ? fHei : fSong;
      const s = ri === 0 ? 11 : 10.5;
      pg.drawText(cell, { x: cols[ci] + 8, y: yTop - ri * rowH - 18, size: s, font: f });
    });
  });
  pg.drawText('备注：以上车辆均投保了机动车损失保险及第三者责任保险。', { x: 60, y: yTop - nR * rowH - 30, size: 11, font: fSong });
  fs.writeFileSync(path.join(__dirname, '_audit', 'C_table_light.pdf'), await doc.save());
  console.log('written C_table_light.pdf');
})().catch(e => { console.error('ERR', e); process.exit(1); });
