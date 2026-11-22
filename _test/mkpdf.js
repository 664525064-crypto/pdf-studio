const path = require('path');
const { PDFDocument, rgb } = require(path.resolve(__dirname, '../renderer/vendor/pdf-lib.min.js'));
const fontkit = require(path.resolve(__dirname, '../renderer/vendor/fontkit.umd.min.js'));
const fs = require('fs');
(async () => {
  async function mk(name, pages, tag) {
    const d = await PDFDocument.create();
    d.registerFontkit(fontkit);
    const font = await d.embedFont(fs.readFileSync(path.resolve(__dirname, '../renderer/vendor/cjk.ttf')), { subset: true });
    for (let i = 1; i <= pages; i++) {
      const p = d.addPage([595, 842]);
      p.drawText(`${tag} - 第 ${i} 页 / 共 ${pages} 页`, { x: 60, y: 760, size: 22, font, color: rgb(0.1, 0.1, 0.1) });
      p.drawText('PDF Studio 测试文档 Sample Text 12345', { x: 60, y: 700, size: 14, font, color: rgb(0.3, 0.3, 0.3) });
      p.drawText('Lorem ipsum dolor sit amet, consectetur adipiscing elit.', { x: 60, y: 660, size: 12, font });
    }
    fs.writeFileSync(path.join(__dirname, name), await d.save());
    console.log(name, fs.statSync(path.join(__dirname, name)).length);
  }
  await mk('test-a.pdf', 3, '文档A');
  await mk('test-b.pdf', 2, '文档B');
})();
