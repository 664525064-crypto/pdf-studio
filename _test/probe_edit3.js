// 解剖保存后的 PDF：dump 页面内容流末尾的追加操作符
const { PDFDocument } = require('C:/Users/Administrator/WorkBuddy/2026-11-16-19-18-26/pdf-studio/renderer/vendor/pdf-lib.min.js') || {};
// vendor 是浏览器构建，node 里直接用原始字节解析更稳：找 content stream 里的白色矩形
const fs = require('fs');
const buf = fs.readFileSync('_out/test-a_编辑文字.pdf');
const s = buf.toString('latin1');
// 找所有 "re f" 填充矩形与 1 1 1 rg
const rgIdx = s.indexOf('1 1 1 rg');
console.log('1 1 1 rg at', rgIdx);
if (rgIdx >= 0) console.log(JSON.stringify(s.slice(rgIdx - 60, rgIdx + 120)));
// 也 dump 文件尾部
console.log('--- tail ---');
console.log(JSON.stringify(s.slice(-500)));
