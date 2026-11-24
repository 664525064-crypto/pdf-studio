/* 单测 splitTableRuns：模拟 OCR 把整行表头（含两行单元格）并成一条行框的场景 */
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
function grab(name) {
  const i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('not found ' + name);
  let d = 0, j = i;
  for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}') { d--; if (!d) break; } }
  return html.slice(i, j + 1);
}
const src = grab('modalSize') + '\n' + grab('splitTableRuns');
eval(src);

// —— 场景1：OCR 整行表头 = 一条行框，6 个格子，其中第1格是两行文字并进来，末格带竖线噪声
// 页面宽 595，字号约 7.5
const mk = (x, y, w, h, str) => ({ x, y, w, h, str });
// 两行文字 y 差 ≈ 9（行距），单行字高 7.5
const items = [
  mk(40, 700, 34, 7.5, '对应《标的'), mk(40, 691, 38, 7.5, '地址序号》'),      // 格1 上下两行
  mk(103, 700, 30, 7.5, '标的名称'),                                         // 格2
  mk(158, 700, 30, 7.5, '出厂编号'),                                         // 格3
  mk(218, 700, 62, 7.5, '保险金额/赔偿限额'),                                 // 格4
  mk(308, 700, 60, 7.5, '保险价值确定方式'),                                   // 格5
  mk(398, 700, 70, 7.5, '赔偿限额、免赔额（率）'),                              // 格6
];
const L = { y: 700, h: 16, size: 16, x: 40, x2: 468, ocr: true, items, text: '对应《标的地址序号》标的名称出厂编号保险金额/赔偿限额保险价值确定方式赔偿限额、免赔额（率）', conf: 88 };
const out = splitTableRuns([L]);
console.log('场景1 拆出行数 =', out.length);
for (const o of out) console.log(`  y=${o.y.toFixed(1)} h=${o.h.toFixed(2)} size=${o.size} x=${o.x.toFixed(1)} x2=${o.x2.toFixed(1)} text=${JSON.stringify(o.text)}`);
// 期望：≥7 行（格1 两行 + 其余 5 格），且格1 的两行 h 都≈7.5 而不是 16
const ok1 = out.length >= 7 && out.every(o => o.h <= 9.5);
console.log('场景1', ok1 ? 'PASS' : 'FAIL', '(期望≥7行且行高≈7.5)');

// —— 场景2：正常句子（间隙均匀小）不拆
const items2 = [
  mk(60, 500, 90, 9, '保险人同意在本保单条款'), mk(150, 500, 88, 9, '规定的保险责任范围内'),
  mk(238, 500, 4, 9, '，'), mk(242, 500, 120, 9, '对保险期限内被保险人的'),
];
const L2 = { y: 500, h: 9, size: 9, x: 60, x2: 362, items: items2, text: '保险人同意在本保单条款规定的保险责任范围内，对保险期限内被保险人的' };
const out2 = splitTableRuns([L2]);
console.log('\n场景2 拆出行数 =', out2.length, out2.length === 1 && out2[0] === L2 ? 'PASS' : 'FAIL');

// —— 场景3：文字层表格行（单行、列间隙大）拆成 4 格
const items3 = [mk(50, 300, 60, 10.5, '姓名：'), mk(150, 300, 80, 10.5, '张三三'), mk(280, 300, 40, 10.5, '男'), mk(360, 300, 90, 10.5, '1985年3月')];
const L3 = { y: 300, h: 10.5, size: 10.5, x: 50, x2: 450, items: items3, text: '姓名：张三三男1985年3月' };
const out3 = splitTableRuns([L3]);
console.log('\n场景3 拆出行数 =', out3.length, out3.length === 4 ? 'PASS' : 'FAIL');
out3.forEach(o => console.log('  ', JSON.stringify(o.text), 'size=' + o.size));

// —— 场景4：OCR 单格上下两行并进一个行框（无列间隙可拆）→ y 聚类拆两行
const items4 = [mk(100, 400, 34, 8, '投保人'), mk(100, 391, 60, 8, '某某有限公司')];
const L4 = { y: 400, h: 17, size: 17, x: 100, x2: 160, items: items4, text: '投保人某某有限公司' };
const out4 = splitTableRuns([L4]);
console.log('\n场景4 拆出行数 =', out4.length, out4.length === 2 && out4.every(o => o.h <= 10) ? 'PASS' : 'FAIL');
out4.forEach(o => console.log('  ', JSON.stringify(o.text), 'h=' + o.h, 'size=' + o.size));
