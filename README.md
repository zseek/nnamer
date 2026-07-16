# Nnamer

TXT 小说批量智能命名工具。使用 LLM API 分析文件名并自动重命名，支持冲突检测和安全去重。

## 功能特性

- 扫描指定目录的 TXT 文件
- 批量调用 OpenAI 兼容 API 智能识别小说书名
- 自动检测命名冲突
- 同一书名保留最大文件，其余移入回收站
- 两阶段安全重命名，防止覆盖
- Windows 原生回收站支持

## 开发环境

### 前置要求

- Node.js 24+
- Rust 1.96+
- pnpm 11+

### 开发模式

```bash
pnpm install
pnpm tauri dev
```

### 构建发布版本

```bash
pnpm tauri build
```

## 技术栈

- **前端**: React + TypeScript + Vite + Tailwind CSS + Zustand
- **桌面框架**: Tauri 2
- **后端**: Rust + reqwest + trash + tauri-plugin-dialog

## 许可证

MIT
