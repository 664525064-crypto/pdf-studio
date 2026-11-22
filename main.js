const { app, BrowserWindow, ipcMain, dialog, protocol, session, screen } = require('electron');
const path = require('path');
const fs = require('fs');

// 测试钩子：设置了 PDFSTUDIO_OUTPUT_DIR 时保存操作免对话框直接落盘
const OUT_DIR = process.env.PDFSTUDIO_OUTPUT_DIR || null;

app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

let win = null;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.pdf': 'application/pdf'
};

function createWindow() {
  // 尽量给侧栏多留高度：25 项工具在 780 高的窗口里要滚很远
  let w = 1200, h = 820;
  try {
    const wa = screen.getPrimaryDisplay().workAreaSize;
    w = Math.min(1280, Math.max(960, wa.width - 60));
    h = Math.min(940, Math.max(640, wa.height - 40));
  } catch (e) {}
  win = new BrowserWindow({
    width: w,
    height: h,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#f5f6f8',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'renderer', 'icon', 'app.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  win.setMenuBarVisibility(false);
  win.loadURL('app://pdfstudio/renderer/index.html');
  win.once('ready-to-show', () => win.show());
}

app.whenReady().then(async () => {
  console.log('[boot] whenReady fired');
  // 自定义 scheme 有 HTTP 缓存，升级后必须先清缓存再开窗口
  await session.defaultSession.clearCache();
  console.log('[boot] clearCache done');

  // Electron 22 用 registerFileProtocol（protocol.handle 需要 25+）
  protocol.registerFileProtocol('app', (request, callback) => {
    try {
      const url = new URL(request.url);
      let p = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if (!p) p = 'renderer/index.html';
      const fp = path.join(__dirname, p);
      if (!fp.startsWith(__dirname)) return callback({ error: -3 });
      callback({ path: fp });
    } catch (e) {
      callback({ error: -2 });
    }
  });

  createWindow();
  console.log('[boot] createWindow called');
});

app.on('window-all-closed', () => app.quit());

/* ---------- IPC ---------- */

ipcMain.handle('ps-info', () => ({ outDir: OUT_DIR, platform: process.platform }));

/* ---------- 系统字体：改字时用原文同款字体写回去 ---------- */
/* 直接读本机已装字体（宋体/黑体/楷体/仿宋），命中率比自带单一字体高得多，
   嵌进 PDF 时只保留用到的字形（subset），输出文件不会变大。 */
const SYS_FONTS = {
  win32: {
    song: [['C:/Windows/Fonts/simsun.ttc', 0], ['C:/Windows/Fonts/simsun.ttf', 0], ['C:/Windows/Fonts/SURSONG.TTF', 0]],
    hei: [['C:/Windows/Fonts/msyh.ttc', 0], ['C:/Windows/Fonts/msyh.ttf', 0], ['C:/Windows/Fonts/simhei.ttf', 0]],
    kai: [['C:/Windows/Fonts/simkai.ttf', 0], ['C:/Windows/Fonts/STKAITI.TTF', 0]],
    fang: [['C:/Windows/Fonts/simfang.ttf', 0], ['C:/Windows/Fonts/STFANGSO.TTF', 0]]
  },
  darwin: {
    song: [['/System/Library/Fonts/Supplemental/Songti.ttc', 0], ['/Library/Fonts/Songti.ttc', 0]],
    hei: [['/System/Library/Fonts/PingFang.ttc', 0], ['/System/Library/Fonts/Supplemental/Heiti SC.ttc', 0], ['/Library/Fonts/Arial Unicode.ttf', 0]],
    kai: [['/System/Library/Fonts/Supplemental/Kaiti.ttc', 0], ['/Library/Fonts/Kaiti.ttc', 0]],
    fang: [['/System/Library/Fonts/Supplemental/STFangsong.ttf', 0], ['/Library/Fonts/STFangsong.ttf', 0]]
  }
};

/* TrueType Collection(.ttc) → 单个 .ttf：PDF 库只接受单一字体的 sfnt */
function sfntFromCollection(buf, idx) {
  if (buf.length < 16 || buf.toString('latin1', 0, 4) !== 'ttcf') return buf;
  const num = buf.readUInt32BE(8);
  const i = Math.max(0, Math.min(idx | 0, num - 1));
  const off = buf.readUInt32BE(12 + i * 4);
  const numTables = buf.readUInt16BE(off + 4);
  const tables = [];
  for (let k = 0; k < numTables; k++) {
    const p = off + 12 + k * 16;
    tables.push({
      tag: buf.toString('latin1', p, p + 4),
      check: buf.readUInt32BE(p + 4),
      off: buf.readUInt32BE(p + 8),
      len: buf.readUInt32BE(p + 12)
    });
  }
  let total = 12 + 16 * numTables;
  const dirs = [];
  for (const t of tables) { total = (total + 3) & ~3; dirs.push({ t, pos: total }); total += (t.len + 3) & ~3; }
  const out = Buffer.alloc(total);
  const eb = Math.floor(Math.log2(numTables || 1));
  const sr = (1 << eb) * 16;
  out.writeUInt32BE(0x00010000, 0);
  out.writeUInt16BE(numTables, 4);
  out.writeUInt16BE(sr, 6);
  out.writeUInt16BE(eb, 8);
  out.writeUInt16BE(numTables * 16 - sr, 10);
  dirs.forEach(({ t, pos }, k) => {
    const p = 12 + k * 16;
    out.write(t.tag, p, 4, 'latin1');
    out.writeUInt32BE(t.check, p + 4);
    out.writeUInt32BE(pos, p + 8);
    out.writeUInt32BE(t.len, p + 12);
    try { buf.copy(out, pos, t.off, t.off + t.len); } catch (err) { /* 越界表直接留空 */ }
  });
  return out;
}

ipcMain.handle('ps-font', (e, { family } = {}) => {
  const list = (SYS_FONTS[process.platform] || {})[family];
  if (!list) return null;
  for (const [file, idx] of list) {
    try {
      if (!fs.existsSync(file)) continue;
      const buf = sfntFromCollection(fs.readFileSync(file), idx);
      if (!buf || buf.length < 20000) continue;
      return { family, file, bytes: new Uint8Array(buf) };
    } catch (err) { /* 换下一个候选 */ }
  }
  return null;
});

ipcMain.handle('ps-save-file', async (e, { name, buf }) => {
  const data = Buffer.from(buf);
  let target = null;
  if (OUT_DIR) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    target = path.join(OUT_DIR, name);
  } else {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: name,
      filters: [{ name: path.extname(name).slice(1).toUpperCase(), extensions: [path.extname(name).slice(1).toLowerCase()] }]
    });
    if (r.canceled || !r.filePath) return null;
    target = r.filePath;
  }
  fs.writeFileSync(target, data);
  return target;
});

ipcMain.handle('ps-save-multi', async (e, { files }) => {
  let dir = OUT_DIR;
  if (!dir) {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], title: '选择保存文件夹' });
    if (r.canceled || !r.filePaths.length) return null;
    dir = r.filePaths[0];
  }
  for (const f of files) {
    fs.writeFileSync(path.join(dir, f.name), Buffer.from(f.bytes));
  }
  return { dir, count: files.length };
});

/* 调试钩子：窗口截图（CDP 在软件渲染/窗口被遮挡时会超时，改用主进程直接抓）
   窗口被别的程序挡住或最小化时 capturePage 会返回空图，先提到最前再抓 */
ipcMain.handle('ps-shot', async () => {
  try {
    const wasTop = win.isAlwaysOnTop();
    if (!win.isVisible()) win.show();
    win.setAlwaysOnTop(true, 'screen-saver');
    win.focus();
    await new Promise(r => setTimeout(r, 280));
    let img = await win.webContents.capturePage();
    if (!img || img.isEmpty()) {
      win.show(); win.moveTop();
      await new Promise(r => setTimeout(r, 520));
      img = await win.webContents.capturePage();
    }
    if (!wasTop) win.setAlwaysOnTop(false);
    return (img && !img.isEmpty()) ? img.toPNG().toString('base64') : null;
  } catch (err) { return null; }
});

/* 渲染自愈：页面刷新前把当前文档暂存到临时文件，刷新后自动恢复 */
const STASH_FILE = () => path.join(app.getPath('temp'), 'pdfstudio-stash.json');
ipcMain.handle('ps-stash', (e, data) => {
  try { fs.writeFileSync(STASH_FILE(), JSON.stringify(data)); return true; } catch (err) { return false; }
});
ipcMain.handle('ps-restore', () => {
  try {
    const d = JSON.parse(fs.readFileSync(STASH_FILE(), 'utf8'));
    try { fs.unlinkSync(STASH_FILE()); } catch (err) {}
    return d;
  } catch (err) { return null; }
});
