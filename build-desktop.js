/* 构建脚本：把 renderer + main.js 组装进 _build/electron-{x64,ia32}/app/resources/app
 * 并把 electron.exe 复制为「PDF全能工作台.exe」
 * 用法: node build-desktop.js
 */
var fs = require('fs');
var path = require('path');
var root = __dirname;
var EXE = 'PDF全能工作台.exe';

function copyTo(rel, destDir) {
  var src = path.join(root, rel);
  var dst = path.join(destDir, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.isDirectory()) copyDir(path.join(src, e.name), path.join(dst, e.name));
    else fs.copyFileSync(path.join(src, e.name), path.join(dst, e.name));
  }
}

function buildFor(arch) {
  var appDir = path.join(root, '_build', 'electron-' + arch, 'app', 'resources', 'app');

  copyDir(path.join(root, 'renderer'), path.join(appDir, 'renderer'));
  copyTo('main.js', appDir);
  copyTo('preload.js', appDir);
  copyTo('package.json', appDir);

  var exeSrc = path.join(root, '_build', 'electron-' + arch, 'app', 'electron.exe');
  fs.copyFileSync(exeSrc, path.join(root, '_build', 'electron-' + arch, 'app', EXE));

  console.log('assembled:', appDir);
}

buildFor('x64');
buildFor('ia32');
console.log('done');
