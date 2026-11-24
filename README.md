# PDF 全能工作台

离线 PDF 工具箱（Windows / macOS），Electron 22 + 内置 pdf.js / pdf-lib / Tesseract，**全程本地处理、零联网、零上传**。

## 功能（31 个工具）

- **页面组织**：合并、拆分、提取、删除、旋转、页面裁剪（四边边距 / 自动去白边）
- **编辑**：所见即所得文字编辑器（改字/增删段落自动重排、列表自动编号、行距段距、字体字号颜色、批注跟字走、OCR 识别中英文、AI 助手本地规则）、编辑图片、加文字/图章、插入图片、**手写签名**（签名板绘制 → 透明 PNG 落章，可附签名日期）、添加页码、水印、文档信息/重命名（标题/作者/主题/关键词 + 自动重命名）
- **转 Office**：PDF → Word / Excel / PPT（自研 zip 写码器，产出可直接用 Office/WPS 打开）
- **转换**：PDF → 图片（PNG/JPG）、图片 → PDF、文本提取、PDF → HTML（扫描件自动嵌页面截图）/ TXT / EPUB、压缩（质量/分辨率分级）、修复、提取图片（解码嵌入位图/内联图 → PNG）
- **注释**：关键词高亮
- **保护**：加密、解密、权限设置、敏感信息打码、展平 PDF（表单/批注拍平，可保留链接）
- **工具**：PDF 比较（逐页行级 diff，红绿 HTML 报告）
- **批量**：多文件批量处理（合并/转换等工具支持文件列表多选）

## 运行

开发模式直接把本目录作为 Electron 应用加载：

```
electron .
```

## 打包

- **Windows**：`node build-desktop.js` 组装目录 → NSIS 打包（`NSIS.exe /DARCH=x64 installer.nsi`，支持 x64 / ia32，兼容 Win7 SP1+）
- **macOS**：`python _build_mac.py`（x64 + arm64 双架构 .app zip）

内置 Electron 22.3.27（Chromium 108），无需联网下载任何运行时。

## 测试

四套回归（dev 与装机版各跑一轮）：

| 套件 | 内容 | 规模 |
|---|---|---|
| `_test/cdp_test.js` | CDP 端到端，覆盖 31 个工具核心路径 + 编辑器重排/WYSIWYG/OCR/签名 | 112 项 |
| `_test/audit_fidelity.js` | 编辑保真审计（居中/右对齐/表格/混排/加粗/真实保单 6 语料，几何断言） | 31 项 |
| `_test/audit_ocr.js` | OCR 扫描表格编辑审计（拆列/字号/位置/不吞格） | 8 项 |
| `_test/office_validate.js` | Office 导出真实打开验证（python-docx / openpyxl 解析） | 8 项 |

```
# 启动应用并开调试端口
electron . --remote-debugging-port=9234

# 跑全量测试
CDP_PORT=9234 OUT_DIR=<静默保存目录> node _test/cdp_test.js
```

## 目录结构

```
main.js            Electron 主进程（窗口/协议/静默保存）
preload.js         渲染进程桥接
renderer/          UI + 全部业务逻辑（单文件 index.html）
renderer/vendor/   pdf.js / pdf-lib / tesseract.js / cmaps / 字体（本地内置）
build-desktop.js   组装 + 打包脚本
installer.nsi      NSIS 安装包脚本
_test/             四套回归脚本与测试语料
```

## 致谢

功能设计参考了开源项目 [Stirling-PDF](https://github.com/Stirling-Tools/Stirling-PDF)（MIT）的工具清单，全部以 pdf-lib + pdf.js 自研实现。

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
