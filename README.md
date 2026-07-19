
<p align="center">
  <h1 align="center">Nnamer</h1>
  <p align="center"><strong>本地 TXT 小说文件批量智能重命名工具</strong></p>
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
  <a href="https://v2.tauri.app/"><img src="https://img.shields.io/badge/Tauri-2-24C8D8?logo=tauri" alt="Tauri"></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-19-61DAFB?logo=react" alt="React"></a>
  <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/Rust-stable-orange?logo=rust" alt="Rust"></a>
</p>

<p align="center">使用 AI 智能生成建议文件名进行批量重命名，智能整理本地 TXT 小说文件名</p>

<p align="center">
  <a href="#功能特性">功能特性</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#使用指南">使用指南</a> •
  <a href="#开发">开发</a>
</p>

---

## 功能特性

### 🎯 核心能力

- **AI 驱动识别** - 调用 OpenAI 兼容 API 批量生成建议文件名
- **海量文件支持** - 虚拟列表，轻松处理数千到数万文件
- **智能冲突处理** - 自动检测同名冲突，按文件大小生成清理方案
- **安全可靠** - 两阶段重命名，删除文件移入系统回收站
- **高效并发** - 可配置批次大小、并发数、超时与重试

### ✨ 交互体验

- 建议名称实时编辑与校验
- 支持筛选、排序、搜索、全选与 Shift 区间选择
- 结构化日志，可查看每次请求/响应详情
- 右键菜单快捷操作
- 支持多实例，同时处理不同目录

## 快速开始

### 安装

**使用发布包**

从 [GitHub Releases](https://github.com/zseek/nnamer/releases) 下载最新版本：

- **Windows 便携版** - `Nnamer_x.x.x_x64.exe`（单文件，无需安装）
- **Windows 安装包** - `Nnamer_x.x.x_x64-setup.exe`（NSIS 安装程序）或 `.msi` 文件

> 当前主要在 Windows 上构建和验证。macOS / Linux 代码具备跨平台基础，需在对应系统自行构建与测试。

**从源码构建**

```bash
# 克隆仓库
git clone https://github.com/zseek/nnamer.git
cd nnamer

# 安装依赖
pnpm install

# 开发模式运行
pnpm tauri dev

# 构建发布版
pnpm build
```

## 使用指南

### 基本流程

1. **配置 API**
  打开「设置」，填写 OpenAI 兼容 API 的 Base URL、API Key、模型名称，以及批次大小、并发数、超时时间、重试次数和系统提示词。
2. **选择目录**
  点击「选择目录」，扫描该目录下的 `.txt` 文件（仅当前层，不递归）。
3. **分析文件**
  勾选需要处理的文件，点击「分析已选」。分析过程中可随时暂停；返回后可编辑建议名称。
4. **处理冲突**
  多个文件建议名相同时会标记为冲突。点击「清理冲突」，保留每组最大的文件，其余移入回收站。
5. **执行重命名**
  勾选状态为「可执行」的文件，确认后执行重命名。成功项会标记为「已重命名」。

### 文件状态说明


| 状态   | 说明              |
| ---- | --------------- |
| 待分析  | 尚未分析            |
| 分析中  | 正在请求 LLM        |
| 可执行  | 建议有效、与当前名不同且无冲突 |
| 无需修改 | 建议名与当前文件名一致     |
| 已重命名 | 已成功改名           |
| 冲突   | 多个文件使用相同建议名     |
| 失败   | 网络、解析、校验或文件操作失败 |


## 开发

### 常用命令

```bash
pnpm install    # 安装依赖
pnpm tauri dev  # 开发运行
pnpm test       # 前端测试
pnpm build      # 构建发布版
```

### 项目结构

```text
Nnamer/
├── src/                          # React 前端
│   ├── Toolbar.tsx               # 工具栏（目录/分析/重命名）
│   ├── FileList.tsx              # 虚拟化文件列表
│   ├── SettingsDialog.tsx        # 设置对话框
│   ├── Logger.tsx                # 分析日志查看器
│   ├── DesktopInteractionLayer.tsx # 快捷键与右键菜单
│   ├── store/                    # Zustand 状态管理
│   └── shared/                   # 类型、API、工具函数与测试
├── src-tauri/                    # Rust 后端
│   └── src/
│       ├── files.rs              # 文件扫描、重命名、回收站
│       ├── llm.rs                # LLM 请求与响应解析
│       ├── naming.rs             # 文件名规范化与校验
│       ├── settings.rs           # 配置读写
│       └── logger.rs             # 分析请求日志事件
├── package.json
├── LICENSE
└── README.md
```

### 技术栈

**桌面框架**

- [Tauri 2](https://v2.tauri.app/) - 跨平台桌面应用框架

**前端**

- [React 19](https://react.dev/) - UI 框架
- [TypeScript](https://www.typescriptlang.org/) - 类型安全
- [Vite 7](https://vitejs.dev/) - 构建工具
- [Zustand](https://zustand-demo.pmnd.rs/) - 状态管理
- [Tailwind CSS 4](https://tailwindcss.com/) - 样式
- [@tanstack/react-virtual](https://tanstack.com/virtual) - 虚拟列表

**后端**

- [Rust](https://www.rust-lang.org/) - 系统编程语言
- [reqwest](https://docs.rs/reqwest/) - HTTP 客户端
- [serde](https://serde.rs/) - 序列化/反序列化
- [trash](https://docs.rs/trash/) - 跨平台回收站

## 注意事项

- 仅扫描选定目录的第一层 `.txt` 文件，不递归子目录
- 删除操作会将文件移入系统回收站（Windows 回收站 / macOS 废纸篓 / Linux Trash），可在系统中恢复
- 再次启动程序会打开新实例，各实例工作区独立，但共享设置文件
- 文件名规则采用跨平台兼容策略（替换非法字符、拒绝保留设备名），便于在不同系统间迁移

## 许可证

本项目基于 [MIT License](LICENSE) 开源