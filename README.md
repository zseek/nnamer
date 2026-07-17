# Nnamer

TXT 小说批量智能命名工具。使用 LLM API 分析文件名并自动重命名，支持冲突检测和安全去重。

## ✨ 功能特性

- 📁 扫描指定目录的 TXT 文件（仅第一层，非递归）
- 🤖 批量调用 OpenAI 兼容 API 智能识别小说书名
- 🔍 自动检测命名冲突
- 🗑️ 同一书名保留最大文件，其余移入回收站
- 🛡️ 两阶段安全重命名，防止覆盖和循环依赖
- 💾 Windows 原生回收站支持
- ⚙️ 完整的设置界面：API 配置、模型、批次大小、重试次数、并发数和系统提示词
- ✏️ 可编辑的建议文件名
- ✅ 全选/单选文件支持
- 📊 实时状态统计和进度显示

## 🖥️ 界面预览

简洁的桌面工具风格界面：
- **工具栏**：选择目录、设置、分析、执行重命名
- **文件列表**：表格展示所有文件，支持排序、编辑、选择
- **状态栏**：实时显示文件统计信息

## 🚀 快速开始

### 前置要求

- Node.js 24+
- Rust 1.96+
- pnpm 11+
- Windows 操作系统

### 开发模式

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm tauri dev
```

### 构建发布版本

```bash
pnpm tauri build
```

生成的安装包位于 `src-tauri/target/release/bundle/`

## 📖 使用指南

1. **配置 API**
   - 点击工具栏的"设置"按钮
   - 填写 OpenAI 兼容的 API 端点（如 `https://api.openai.com/v1`）
   - 填写 API Key
   - 选择模型（如 `gpt-4o-mini`、`claude-3-5-sonnet` 等）
   - 可自定义系统提示词

2. **选择目录**
   - 点击"选择目录"按钮
   - 选择包含 TXT 文件的文件夹
   - 查看扫描到的文件列表

3. **分析文件**
   - 勾选文件后点击“分析已选”，批量调用 LLM 识别书名
   - 可在设置中调整每批文件数、失败重试次数和并发请求数
   - 长时间任务可随时暂停；已发送的请求会完成回填，恢复后继续剩余批次
   - 每批响应完成后会立即显示建议文件名和最新状态
   - 可手动编辑任意建议文件名

4. **处理冲突**
   - 如果有冲突文件（多个文件建议相同名称）
   - 点击"保留最大文件"自动处理
   - 较小的文件将被移入回收站

5. **执行重命名**
   - 勾选要重命名的文件
   - 点击"执行重命名"
   - 确认操作完成

## 🏗️ 技术栈

### 前端
- **React 19** - UI 框架
- **TypeScript 5.8** - 类型安全
- **Vite 7** - 构建工具
- **Tailwind CSS 4** - 样式系统
- **Zustand 5** - 状态管理

### 桌面框架
- **Tauri 2** - 跨平台桌面应用框架

### 后端 (Rust)
- **reqwest** - HTTP 客户端，调用 LLM API
- **serde_json** - JSON 序列化
- **trash** - 回收站操作
- **uuid** - 文件 ID 生成

## 📂 项目结构

```
Nnamer/
├── src/                      # React 前端代码
│   ├── App.tsx               # 主应用组件
│   ├── Toolbar.tsx           # 工具栏组件
│   ├── FileList.tsx          # 文件列表组件
│   ├── StatusBar.tsx         # 状态栏组件
│   ├── SettingsDialog.tsx    # 设置对话框组件
│   ├── store/                # Zustand 状态管理
│   └── shared/               # 共享代码
│       ├── lib/api.ts        # Tauri API 调用
│       ├── lib/fileUtils.ts  # 文件工具函数
│       └── types.ts          # TypeScript 类型定义
├── src-tauri/                # Rust 后端代码
│   └── src/
│       ├── main.rs           # 主入口
│       ├── lib.rs            # 库入口
│       ├── files.rs          # 文件操作（扫描、重命名、回收站）
│       ├── llm.rs            # LLM 客户端（API 调用、JSON 解析）
│       ├── naming.rs         # 名称标准化和验证
│       ├── settings.rs       # 设置管理（保存/加载配置）
│       └── error.rs          # 错误类型定义
├── LLM_DESIGN.md             # LLM 输入输出设计文档
├── DEVELOPMENT.md            # 开发总结文档
└── README.md                 # 本文件
```

## ⚙️ 核心设计

### 文件状态机

```
pending → analyzing → ready / unchanged / conflict / failed
```

- **pending**: 待分析
- **analyzing**: 正在等待 LLM 响应
- **ready**: 建议名称有效、与源名称不同且没有冲突，可以执行重命名
- **unchanged**: 建议名称与源文件名一致，无需执行重命名
- **conflict**: 多个文件使用了相同的建议名称，需要修改后才能执行
- **failed**: API、解析或名称校验失败，详细原因保存在错误信息中

用户修改建议文件名后，名称校验和冲突状态会立即重新计算。主列表支持按以上状态筛选。

### 名称标准化

- 去除 `.txt` 扩展名
- 替换 Windows 非法字符（`< > : " / \ | ? *`）为全角字符
- 去除首尾空白和尾随句点
- 限制长度 180 字符
- 检查保留设备名（`CON`、`PRN`、`AUX` 等）

### 冲突处理策略

- 按 Windows 大小写不敏感规则分组
- 同组内保留最大文件
- 其余文件可移入回收站
- 并列最大需手动处理

### 安全重命名机制

- **两阶段改名**：
  1. 源文件 → 临时文件（`~nnamer_temp_uuid.txt`）
  2. 临时文件 → 目标文件
- 支持名称交换（A→B 同时 B→A）
- 防止循环占用
- 元数据校验防止文件在重命名过程中被修改

## 📝 许可证

MIT

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## ⚠️ 注意事项

- 仅支持 Windows 系统（回收站功能依赖 Windows API）
- API Key 以明文形式保存在本机配置目录（`%APPDATA%\com.nnamer.app\settings.json`）
- 需要联网访问 LLM API
- 文件移入回收站后可通过系统回收站恢复，但程序内无法直接恢复
- 仅扫描选定目录的第一层文件，不会递归扫描子目录
