# uiZip — 精美的 Windows 解压缩工具 | A Beautiful Windows Archive Tool

<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="uiZip Logo" width="128" />
</p>

<p align="center">
  <strong>基于 Tauri v2 + React | Built with Tauri v2 + React</strong><br>
  内置 7-Zip 引擎，无需额外安装 | Bundled 7-Zip engine, no extra install needed
</p>

---

## 功能特性 | Features

| 特性 Feature | 说明 Description |
|:--|:--|
| **中英双语** | UI 完整支持中文 / English，一键切换 |
| **UI 主题** | Material Design（默认）、深色模式、玻璃拟态、新拟态，四种主题 |
| **压缩** | 13 种格式：7z, ZIP, TAR, GZip, BZip2, XZ, LZMA, Zstd, ISO, CAB, ARJ, LZH, WIM |
| **解压** | 27+ 种后缀，含分卷 (.001, .r00)、复合扩展名 (.tar.gz 等) |
| **分卷压缩** | 自定义分卷大小（如 100M, 1G） |
| **密码保护** | 压缩 / 解压均支持 AES-256 加密 |
| **完整性测试** | 一键检测压缩包是否损坏 |
| **追加 / 删除** | 已创建的压缩包可动态增删文件 |
| **内建 7z** | 自带 7z.exe / 7z.dll，用户无需额外安装 |
| **后台留存** | 关闭窗口隐藏到系统托盘，进程常驻 |
| **文件关联** | 安装后自动关联 22 种压缩格式 |
| **PATH 注册** | 终端直接运行 `uizip` 命令 |
| **拖放支持** | 拖入压缩包自动切换解压模式 |
| **内嵌 WebView2** | 安装时自动检测并静默安装 |

| Feature | Description |
|:--|:--|
| **Bilingual** | Full Chinese / English UI, one-click switch |
| **UI Themes** | Material Design (default), Dark Mode, Glassmorphism, Neumorphism |
| **Compress** | 13 formats: 7z, ZIP, TAR, GZip, BZip2, XZ, LZMA, Zstd, ISO, CAB, ARJ, LZH, WIM |
| **Extract** | 27+ extensions, including split volumes (.001, .r00), compound (.tar.gz) |
| **Split Volumes** | Custom volume size (e.g. 100M, 1G) |
| **Password** | AES-256 encryption for both compress and extract |
| **Integrity Test** | One-click archive corruption check |
| **Add / Delete** | Modify existing archives dynamically |
| **Bundled 7z** | Ships with 7z.exe / 7z.dll, zero dependencies |
| **System Tray** | Minimize to tray, process stays resident |
| **File Association** | Auto-associates 22 archive formats on install |
| **PATH Registration** | Run `uizip` directly from terminal |
| **Drag & Drop** | Drop archives or files directly onto the window |

---

## 系统要求 | Requirements

- Windows 10 x64 或更高 | Windows 10 x64 or later
- [WebView2 Runtime](https://go.microsoft.com/fwlink/p/?LinkId=2124703) — 安装包会自动安装 | Installer installs it automatically

---

## 安装 | Installation

从 [Releases](https://github.com/cheng343/uizip/releases) 下载 `uiZip_X.X.X_x64-setup.exe`，双击安装。

Download `uiZip_X.X.X_x64-setup.exe` from [Releases](https://github.com/cheng343/uizip/releases) and run it.

---

## 截图 | Screenshots

| 压缩 Compress | 解压 Extract | 设置 Settings |
|:---:|:---:|:---:|
| ![compress](screenshots/compress.png) | ![extract](screenshots/extract.png) | ![settings](screenshots/settings.png) |

---

## 开发 | Development

### 环境准备 | Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://www.rust-lang.org/) 1.77+ (MSVC toolchain)
- Windows SDK 10.0+

### 克隆并运行 | Clone & Run

```bash
git clone https://github.com/cheng343/uizip.git
cd uizip
npm install
npx tauri dev
```

### 构建 | Build

```bash
npx tauri build --bundles nsis
# 输出 | Output: src-tauri/target/release/bundle/nsis/uiZip_X.X.X_x64-setup.exe
```

---

## 项目结构 | Project Structure

```
uizip/
├── src/                        # React 前端 | Frontend
│   ├── App.tsx                 # 主界面 | Main UI (~500 lines)
│   ├── App.css                 # Material Design 样式 | Styles
│   ├── locale.ts               # 国际化 | i18n (zh/en)
│   ├── main.tsx                # React 入口 | Entry
│   ├── tauri.d.ts              # Tauri 类型 | Type declarations
│   └── theme/                  # 主题系统 | Theme system
│       ├── ThemeContext.tsx     # React Context + CSS 变量应用
│       ├── themes.ts           # 4 套主题颜色定义
│       └── types.ts            # 类型定义
├── src-tauri/                  # Rust 后端 | Backend
│   ├── src/
│   │   ├── lib.rs              # 核心 | Core: 7z 子进程, 流式进度, 托盘 (~540 lines)
│   │   └── main.rs             # 入口 | Entry
│   ├── resources/              # 内嵌资源 | Bundled
│   │   ├── 7z.exe / 7z.dll     # 7-Zip 引擎 (v25.01)
│   │   ├── WebView2Loader.dll
│   │   └── MicrosoftEdgeWebview2Setup.exe
│   ├── nsis/installer.nsh     # NSIS 安装钩子 (PATH + WebView2)
│   ├── icons/                  # 应用图标 | App icons
│   ├── tauri.conf.json         # Tauri 配置
│   └── Cargo.toml
├── .github/workflows/build.yml # CI/CD
├── package.json
├── vite.config.ts
└── LICENSE                     # GPL-3.0
```

---

## 技术栈 | Tech Stack

| 层级 | Layer | 技术 | Technology |
|:--|:--|:--|:--|
| 前端 | Frontend | React 19, TypeScript, Vite 8 |
| 后端 | Backend | Rust, Tauri v2.11 |
| 压缩引擎 | Engine | 7-Zip 25.01 (7z.exe + 7z.dll) |
| 打包 | Package | NSIS (Windows Installer) |
| CI/CD | | GitHub Actions (windows-latest) |
| WebView | | WebView2 + system tray |

---

## 主题 | Themes

| id | 名称 | Name | 说明 | Description |
|:--|:--|:--|:--|:--|
| `material` | Material Design | Material Design | Material You / M3 风格，紫色主色调（默认） | Purple primary, M3 style (default) |
| `dark` | 深色模式 | Dark Mode | 蓝紫色点缀的深夜间主题 | Deep dark with blue-purple accents |
| `glassmorphism` | 玻璃拟态 | Glassmorphism | 渐变背景 + 半透明毛玻璃 | Gradient bg + translucent blur panels |
| `neumorphism` | 新拟态 | Neumorphism | 柔和内外阴影立体感 | Soft inset/outset shadows, 3D feel |

---

## 支持的格式 | Supported Formats

### 压缩 | Compress (13 种)
`7z` `zip` `tar` `gz` `bz2` `xz` `lzma` `zst` `iso` `cab` `arj` `lzh` `wim`

### 解压 | Extract (27+ 种)
以上所有 + `rar` `cpio` `lha` `tgz` `tbz2` `txz` `tzst` + 分卷 `.001` `.r00`

---

## 许可证 | License

[GPL-3.0](LICENSE) — 本项目基于 7-Zip (LGPL) 构建。 | Built on 7-Zip (LGPL).

7-Zip Copyright (C) 1999-2025 Igor Pavlov.

---

## 致谢 | Acknowledgments

- [7-Zip](https://www.7-zip.org/) — Igor Pavlov 的传奇压缩引擎 | The legendary archive engine
- [Tauri](https://tauri.app/) — 轻量 Rust 桌面框架 | Lightweight Rust desktop framework
- [React](https://react.dev/) — UI 库 | UI library
- [Vite](https://vite.dev/) — 构建工具 | Build tool
- Material Design 3 — Google 设计语言 | Google design language
