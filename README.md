# uiZip — 精美的 Windows 解压缩工具 | A Beautiful Windows Archive Tool

<p align="center">
  <img src="src-tauri/icons/128x128.png" alt="uiZip Logo" width="128" />
</p>

<p align="center">
  <strong>基于 Tauri v2 + React 构建 | Built with Tauri v2 + React</strong><br>
  内置 7-Zip 引擎，无需额外安装 | Bundled 7-Zip engine, no extra install needed
</p>

---

## 功能特性 | Features

- **UI 主题** — Material Design（默认），支持深色 / 玻璃拟态 / 新拟态四种主题，一键切换
- **压缩** — 支持 13 种格式：7z, ZIP, TAR, GZip, BZip2, XZ, LZMA, Zstd, ISO, CAB, ARJ, LZH, WIM
- **解压** — 支持 27+ 种后缀，包括分卷（.001, .r00）、复合扩展名（.tar.gz 等）
- **分卷压缩** — 支持自定义分卷大小（如 100M, 1G）
- **密码保护** — 压缩/解压均支持 AES-256 加密
- **完整性测试** — 一键检测压缩包是否损坏
- **追加/删除** — 已创建的压缩包可动态添加或删除文件
- **内建 7z** — 自带 7z.exe / 7z.dll，用户无需安装 7-Zip
- **后台留存** — 关闭窗口隐藏到系统托盘，进程常驻
- **文件关联** — 安装后自动关联 22 种压缩格式
- **PATH 注册** — 可通过终端 uizip 命令快速调用
- **拖放支持** — 拖入压缩包自动切换解压模式，拖入文件自动添加
- **内嵌 WebView2** — 安装时自动检测并静默安装 WebView2 Runtime
- **全中文界面** — 所有文字均为简体中文

---

## 系统要求 | Requirements

- Windows 10 x64 或更高
- [WebView2 Runtime](https://go.microsoft.com/fwlink/p/?LinkId=2124703)（安装包会自动安装）

---

## 安装 | Installation

从 [Releases](https://github.com/cheng343/uizip/releases) 下载 uiZip_X.X.X_x64-setup.exe，双击安装。

或通过 Scoop（即将支持）：

`powershell
scoop bucket add cheng343 https://github.com/cheng343/scoop-bucket
scoop install uizip
`

---

## 开发 | Development

### 环境准备 | Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [Rust](https://www.rust-lang.org/) 1.77+ (MSVC toolchain)
- [Tauri CLI](https://v2.tauri.app/) (通过 npm 安装)
- Windows SDK 10.0+

### 克隆并运行 | Clone & Run

\\\ash
git clone https://github.com/cheng343/uizip.git
cd uizip

# 安装前端依赖
npm install

# 开发模式运行（热重载）
npx tauri dev

# 或直接启动前端开发服务器
npm run dev
\\\

### 构建 | Build

\\\ash
# 构建 NSIS 安装包
npx tauri build --bundles nsis

# 输出位置
# src-tauri/target/release/bundle/nsis/uiZip_X.X.X_x64-setup.exe
\\\

### 项目结构 | Project Structure

\\\
uizip/
├── src/                    # React 前端 | Frontend
│   ├── App.tsx             # 主界面逻辑 | Main UI logic
│   ├── App.css             # Material Design 样式 | Styles
│   ├── main.tsx            # React 入口 | Entry point
│   ├── index.css           # 全局样式 | Global styles
│   ├── tauri.d.ts          # Tauri 类型声明 | Type declarations
│   └── theme/              # 主题系统 | Theme system
│       ├── index.ts        # 导出 | Exports
│       ├── ThemeContext.tsx # React Context
│       ├── themes.ts       # 4 套主题定义 | 4 theme definitions
│       └── types.ts        # 类型定义 | Type definitions
├── src-tauri/              # Rust 后端 | Backend
│   ├── src/
│   │   ├── lib.rs          # 核心逻辑 | Core logic (7z 子进程, 流式进度, 托盘)
│   │   └── main.rs         # 入口 | Entry point
│   ├── resources/          # 内嵌资源 | Bundled resources
│   │   ├── 7z.exe          # 7-Zip 命令行
│   │   ├── 7z.dll          # 7-Zip 动态库
│   │   ├── WebView2Loader.dll
│   │   └── MicrosoftEdgeWebview2Setup.exe
│   ├── nsis/               # NSIS 安装钩子 | Installer hooks
│   │   └── installer.nsh
│   ├── icons/              # 应用图标 | App icons
│   ├── tauri.conf.json     # Tauri 配置 | Tauri config
│   └── Cargo.toml          # Rust 依赖 | Rust dependencies
├── .github/workflows/      # CI/CD (GitHub Actions)
│   └── build.yml
├── index.html              # HTML 模板
├── package.json            # Node 依赖 | Node dependencies
├── vite.config.ts          # Vite 配置 | Vite config
└── README.md               # 本文件 | This file
\\\

---

## 技术栈 | Tech Stack

| 层级 | Layer | 技术 | Technology |
|------|-------|------|------------|
| 前端 | Frontend | React 19, TypeScript, Vite 8 |
| 后端 | Backend | Rust, Tauri v2 |
| 压缩引擎 | Archive Engine | 7-Zip 25.01 (7z.exe + 7z.dll) |
| 打包 | Packaging | NSIS (Windows Installer) |
| CI/CD | CI/CD | GitHub Actions (windows-latest) |
| 桌面框架 | Desktop Framework | WebView2 + system tray |

---

## 主题 | Themes

| 主题 | Theme | 说明 | Description |
|------|-------|------|-------------|
| Material Design | Material You / M3 风格，紫色主色调（默认） |
| 深色模式 | Dark Mode | 蓝紫色点缀的深夜间主题 |
| 玻璃拟态 | Glassmorphism | 渐变背景 + 半透明毛玻璃效果 |
| 新拟态 | Neumorphism | 柔和内外阴影的立体感主题 |

在设置面板中一键切换。

---

## 支持的格式 | Supported Formats

### 压缩 | Compress
7z, ZIP, TAR, GZip, BZip2, XZ, LZMA, Zstd, ISO, CAB, ARJ, LZH, WIM (13 种)

### 解压 | Extract
以上全部 + RAR, CPIO, LHA, TGZ, TBZ2, TXZ, TZST + 分卷 (.001, .r00) (27+ 种后缀)

---

## 许可证 | License

[GPL-3.0](LICENSE) — 基于 7-Zip (LGPL) 构建。

7-Zip 版权所有 © 1999-2025 Igor Pavlov。

---

## 致谢 | Acknowledgments

- [7-Zip](https://www.7-zip.org/) — Igor Pavlov 的传奇压缩引擎
- [Tauri](https://tauri.app/) — 轻量级 Rust 桌面框架
- [React](https://react.dev/) — UI 库
- [Vite](https://vite.dev/) — 构建工具
- Material Design 3 — Google 设计语言
