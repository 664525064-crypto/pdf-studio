const path = require('path');
const { PDFDocument } = require(path.resolve(__dirname, '../renderer/vendor/pdf-lib.min.js'));
const fontkit = require(path.resolve(__dirname, '../renderer/vendor/fontkit.umd.min.js'));
const fs = require('fs');
(async () => {
  const bytes = fs.readFileSync(path.join(__dirname, 'test-a.pdf'));
  const d = await PDFDocument.load(bytes);
  d.registerFontkit(fontkit);
  await d.encrypt({ userPassword: '1234', ownerPassword: '1234', permissions: { printing: 'highResolution', copying: true, annotating: true } });
  fs.writeFileSync(path.join(__dirname, 'test-enc.pdf'), await d.save());
  console.log('test-enc.pdf', fs.statSync(path.join(__dirname, 'test-enc.pdf')).size);
})();
