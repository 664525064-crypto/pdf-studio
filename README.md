# PDF 全能工作台

离线 PDF 工具箱（Windows / macOS），Electron 22 + 内置 pdf.js / pdf-lib / Tesseract，**全程本地处理、零联网、零上传**。

## 功能（25 个工具）

- **编辑器**：所见即所得 PDF 编辑器——改字/增删段落自动重排（下方内容自动下推）、列表自动编号、行距段距调整、字体字号颜色、批注跟字走、AI 助手（本地规则改写/润色/总结）、OCR 文字识别（中英）
- **转换**：PDF → 图片（PNG/JPG）、图片 → PDF、PDF → TXT / HTML（扫描件自动嵌入页面截图）、PDF → Word 文本
- **页面**：合并、拆分、提取、删除、重排、旋转、裁剪、页眉页脚、水印
- **安全**：加密、解密、权限设置
- **压缩**：图片质量/分辨率分级压缩
- **批量**：批量重命名、批量盖章

## 运行

开发模式直接把本目录作为 Electron 应用加载：

```
electron .
```

## 打包

- **Windows**：`node build-desktop.js` 组装目录 → NSIS 打包（`NSIS.exe /DARCH=x64 installer.nsi`，支持 x64/ia32）
- **macOS**：`python _build_mac.py`（x64 + arm64 双架构 .app zip）

内置 Electron 22.3.27（Chromium 108，兼容 Win7 SP1+），无需联网下载任何运行时。

## 测试

CDP 端到端测试 101 项，覆盖 25 个工具核心路径 + 编辑器重排/WYSIWYG/OCR：

```
# 启动应用并开调试端口
electron . --remote-debugging-port=9234

# 跑全量测试
CDP_PORT=9234 node _test/cdp_test.js
```

## 目录结构

```
main.js            Electron 主进程（窗口/协议/静默保存）
preload.js         渲染进程桥接
renderer/          UI + 全部业务逻辑（单文件 index.html）
renderer/vendor/   pdf.js / pdf-lib / tesseract.js / cmaps / 字体（本地内置）
build-desktop.js   组装 + 打包脚本
installer.nsi      NSIS 安装包脚本
_test/             CDP 测试脚本与测试 PDF
```

## 内置第三方库及许可

| 库 | 许可 | 用途 |
|---|---|---|
| pdf.js（含 cmaps、standard_fonts） | Apache-2.0 | 渲染/解析 |
| pdf-lib（@cantoo 分支） | MIT | 写入/修改 |
| fontkit | MIT | 字体子集化 |
| tesseract.js + tesseract-core（wasm） | Apache-2.0 | OCR |

> **字体说明**：编辑器写入新文字时使用 `renderer/vendor/cjk.ttf`。因版权原因（微软雅黑为专有字体），仓库不包含该文件——请自行将一个可嵌入的 CJK 字体（如系统内的 `msyh.ttc` 转出的 ttf，或 [Noto Sans SC](https://github.com/notofonts/noto-cjk)）放到该路径，程序即可正常工作。

## 许可

本项目代码以 MIT 许可开源（见 LICENSE）。第三方库按其各自许可分发。
