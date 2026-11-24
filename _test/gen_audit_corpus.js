/* 保真审计语料生成器：5 类版式 PDF（A4 595.28x841.89）→ _audit/ */
const path = require('path');
const fs = require('fs');
const { PDFDocument, rgb } = require(path.join(__dirname, '..', 'renderer', 'vendor', 'pdf-lib.min.js'));
const fontkit = require(path.join(__dirname, '..', 'renderer', 'vendor', 'fontkit.umd.min.js'));

const OUT = path.join(__dirname, '_audit');
fs.mkdirSync(OUT, { recursive: true });

const songFont = fs.readFileSync('C:/Windows/Fonts/simkai.ttf');  // 楷体（衬线单 TTF，可子集化）
const heiFont = fs.readFileSync('C:/Windows/Fonts/simhei.ttf');

const textW = (font, size, t) => { try { return font.widthOfTextAtSize(t, size); } catch (e) { return t.length * size; } };

/* 逐字画：支持 charSpacing（模拟两端对齐） */
function drawSpaced(page, font, size, t, x, y, cs, color) {
  let cx = x;
  for (const ch of t) {
    page.drawText(ch, { x: cx, y, size, font, color: color || rgb(0, 0, 0) });
    cx += textW(font, size, ch) + (cs || 0);
  }
  return cx - (cs || 0); // 末字右缘
}

(async () => {
  /* ---------- A_center：居中标题 2 行 + 左对齐正文 ---------- */
  {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const song = await doc.embedFont(songFont, { subset: true });
    const hei = await doc.embedFont(heiFont, { subset: true });
    const pg = doc.addPage([595.28, 841.89]);
    const W = 595.28;
    const t1 = '机动车辆商业保险单', t2 = '（电子保单）';
    pg.drawText(t1, { x: (W - textW(hei, 16, t1)) / 2, y: 760, size: 16, font: hei });
    pg.drawText(t2, { x: (W - textW(hei, 16, t2)) / 2, y: 736, size: 16, font: hei });
    const body = [
      '尊敬的客户：您好！感谢您选择我公司为您提供机动车辆保险服务。',
      '本保险单由投保单、保险条款、批单以及其他相关凭证共同组成，',
      '请您仔细阅读保险条款，特别是保险责任与责任免除部分的内容。',
      '如有任何疑问，请及时与我公司客户服务热线联系，我们将竭诚',
      '为您提供服务。',
    ];
    body.forEach((t, i) => pg.drawText(t, { x: 60, y: 700 - i * 22, size: 12, font: song }));
    const h1 = '重要提示';
    pg.drawText(h1, { x: 60, y: 700 - 5 * 22 - 14, size: 13, font: hei });
    ['一、请核实保险单号与被保险人信息是否准确无误。', '二、保险车辆发生事故后请于四十八小时内报案。']
      .forEach((t, i) => pg.drawText(t, { x: 60, y: 700 - 5 * 22 - 40 - i * 22, size: 12, font: song }));
    fs.writeFileSync(path.join(OUT, 'A_center.pdf'), await doc.save());
  }

  /* ---------- B_right：右对齐段落 + 右对齐落款 ---------- */
  {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const song = await doc.embedFont(songFont, { subset: true });
    const hei = await doc.embedFont(heiFont, { subset: true });
    const pg = doc.addPage([595.28, 841.89]);
    const W = 595.28, R = 535;
    const h = '停驶告知书';
    pg.drawText(h, { x: (W - textW(hei, 16, h)) / 2, y: 760, size: 16, font: hei });
    const lines = [
      '兹证明该车已于本月办理停驶手续，',
      '停驶期间发生的交通事故与本公司无关，',
      '请车主妥善保管本告知书以备查验。',
    ];
    lines.forEach((t, i) => {
      const w = textW(song, 12, t);
      pg.drawText(t, { x: R - w, y: 710 - i * 24, size: 12, font: song });
    });
    const sign = '某某财产保险股份有限公司';
    const sign2 = '二〇二六年十一月二十四日';
    [sign, sign2].forEach((t, i) => {
      const w = textW(song, 12, t);
      pg.drawText(t, { x: R - w, y: 710 - 4 * 24 - i * 24, size: 12, font: song });
    });
    fs.writeFileSync(path.join(OUT, 'B_right.pdf'), await doc.save());
  }

  /* ---------- C_table：表格（表头黑体 + 4 行数据） ---------- */
  {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const song = await doc.embedFont(songFont, { subset: true });
    const hei = await doc.embedFont(heiFont, { subset: true });
    const pg = doc.addPage([595.28, 841.89]);
    const W = 595.28;
    const t = '车辆信息登记表';
    pg.drawText(t, { x: (W - textW(hei, 16, t)) / 2, y: 770, size: 16, font: hei });
    const cols = [60, 200, 320, 470]; // 列左缘
    const rows = [
      ['车牌号码', '厂牌型号', '发动机号', '使用性质'],
      ['苏M34412', '徐工XCT8', 'WP1024567', '营业货运'],
      ['苏N77881', '三一STC25', 'SQ5543210', '营业货运'],
      ['苏B12093', '中联ZLJ52', 'ZLJ8890231', '非营业'],
      ['苏J66302', '柳工TC75', 'LG6678123', '非营业'],
    ];
    const yTop = 730, rowH = 26, colW = [140, 120, 150, 80];
    // 网格线
    const nR = rows.length;
    for (let i = 0; i <= nR; i++) {
      pg.drawLine({ start: { x: cols[0], y: yTop - i * rowH }, end: { x: cols[3] + colW[3], y: yTop - i * rowH }, thickness: 0.8, color: rgb(0, 0, 0) });
    }
    for (let c = 0; c <= 4; c++) {
      const xx = c < 4 ? cols[c] : cols[3] + colW[3];
      pg.drawLine({ start: { x: xx, y: yTop }, end: { x: xx, y: yTop - nR * rowH }, thickness: 0.8, color: rgb(0, 0, 0) });
    }
    rows.forEach((r, ri) => {
      r.forEach((cell, ci) => {
        const f = ri === 0 ? hei : song;
        const s = ri === 0 ? 11 : 10.5;
        pg.drawText(cell, { x: cols[ci] + 8, y: yTop - ri * rowH - 18, size: s, font: f });
      });
    });
    pg.drawText('备注：以上车辆均投保了机动车损失保险及第三者责任保险。', { x: 60, y: yTop - nR * rowH - 30, size: 11, font: song });
    fs.writeFileSync(path.join(OUT, 'C_table.pdf'), await doc.save());
  }

  /* ---------- D_mixfont：行内宋体+黑体混排 ---------- */
  {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const song = await doc.embedFont(songFont, { subset: true });
    const hei = await doc.embedFont(heiFont, { subset: true });
    const pg = doc.addPage([595.28, 841.89]);
    const segs = [
      [['特别约定：', song], ['免赔额为零', hei], ['，保险人按照保险合同约定负责赔偿。', song]],
      [['本保险单项下', song], ['第一次', hei], ['事故免赔率为损失金额的', song], ['百分之十', hei], ['。', song]],
      [['投保人声明已充分理解', song], ['责任免除条款', hei], ['的含义并签字确认。', song]],
    ];
    segs.forEach((line, li) => {
      let cx = 60;
      const y = 740 - li * 26;
      for (const [t, f] of line) {
        pg.drawText(t, { x: cx, y, size: 12, font: f });
        cx += textW(f, 12, t);
      }
    });
    fs.writeFileSync(path.join(OUT, 'D_mixfont.pdf'), await doc.save());
  }

  /* ---------- E_bold：整行黑体（模拟加粗行）夹在宋体段落里 ---------- */
  {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const song = await doc.embedFont(songFont, { subset: true });
    const hei = await doc.embedFont(heiFont, { subset: true });
    const pg = doc.addPage([595.28, 841.89]);
    const t = '理赔须知';
    pg.drawText(t, { x: (595.28 - textW(hei, 16, t)) / 2, y: 770, size: 16, font: hei });
    pg.drawText('被保险人索赔时应提供下列单证材料，并对其真实性负责：', { x: 60, y: 730, size: 12, font: song });
    /* 加粗行独立成段：上方留 36pt（> 2.35×字号）空，段落识别才不会把它并进上面/下面的段 */
    const boldLine = '保险单正本、事故证明、维修发票、驾驶证复印件。';
    pg.drawText(boldLine, { x: 60, y: 694, size: 12, font: hei });
    ['未按要求提供完整材料的，保险人有权暂停理赔流程并书面通知，',
     '被保险人应在收到通知后十五日内补充相关材料，逾期视为放弃。',
     '本须知与保险单具有同等效力。']
      .forEach((t2, i) => pg.drawText(t2, { x: 60, y: 658 - i * 22, size: 12, font: song }));
    fs.writeFileSync(path.join(OUT, 'E_bold.pdf'), await doc.save());
  }

  console.log('corpus done:', fs.readdirSync(OUT).join(', '));
  process.exit(0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
