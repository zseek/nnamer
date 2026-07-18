# Nnamer 开发总结

## 项目概览

Nnamer 是一个 Windows 桌面工具，使用 LLM API 批量智能识别和重命名 TXT 小说文件。

## 已完成功能

### 核心功能
- ✅ 扫描指定目录下的所有 TXT 文件（仅第一层）
- ✅ 批量调用 OpenAI 兼容 API 进行文件名分析（每批 10-20 个）
- ✅ 自动检测并标记命名冲突
- ✅ 同一建议名称保留最大文件，其余移入回收站
- ✅ 两阶段安全重命名，防止覆盖和循环依赖
- ✅ Windows 原生回收站支持

### 技术实现
- ✅ Rust 后端：文件扫描、名称校验、LLM 客户端、回收站操作
- ✅ React 前端：目录选择、分析控制、冲突处理、执行预览
- ✅ Zustand 状态管理
- ✅ Tailwind CSS 样式系统
- ✅ Tauri 2 桌面框架

### 测试与验证
- ✅ Rust 单元测试全部通过
- ✅ 前端单元测试全部通过
- ✅ TypeScript 类型检查通过
- ✅ 前端构建成功

## 文件结构

```
Nnamer/
├── src/                          # 前端代码
│   ├── features/                 # 功能模块
│   │   ├── directory-scan/       # 目录扫描
│   │   ├── name-analysis/        # LLM 分析
│   │   ├── conflict-review/      # 冲突处理
│   │   ├── file-execution/       # 重命名执行
│   │   └── settings/             # 设置界面
│   ├── shared/                   # 共享代码
│   │   ├── lib/                  # API 和工具
│   │   └── types.ts              # TypeScript 类型
│   ├── store.ts                  # Zustand 状态管理
│   └── App.tsx                   # 主应用
├── src-tauri/                    # Rust 后端
│   └── src/
│       ├── files.rs              # 文件操作
│       ├── llm.rs                # LLM 客户端
│       ├── naming.rs             # 名称校验
│       ├── settings.rs           # 设置管理
│       └── error.rs              # 错误处理
└── README.md                     # 项目文档
```

## 核心设计

### 文件状态机
- `pending` → `analyzing` → `ready` / `conflict` / `failed`
- LLM 批次返回后立即写入建议名称并计算状态
- 用户编辑建议名称后立即重新执行名称校验和冲突检查

### 名称标准化
- 去除 `.txt` 扩展名
- 替换 Windows 非法字符为全角字符
- 去除首尾空白和尾随句点
- 限制长度 180 字符
- 检查保留设备名

### 冲突处理
- 按 Windows 大小写不敏感规则分组
- 同组最大文件保留，其余可移入回收站
- 并列最大需手动处理

### 安全重命名
- 两阶段改名：先到临时文件，再到目标文件
- 支持名称交换和循环占用
- 元数据校验防止意外修改

## 使用流程

1. **选择目录** - 点击"选择目录"选择包含 TXT 文件的文件夹
2. **配置 API** - 点击"设置"配置 OpenAI 兼容接口和 Prompt
3. **分析文件** - 点击"分析全部"批量调用 LLM 获取建议名称
4. **处理冲突** - 点击"清理冲突"，保留每组唯一最大的文件，并将其余较小文件移入回收站
5. **执行重命名** - 选中状态为"可执行"的文件，再点击"执行重命名"完成文件改名

## 下一步开发建议

1. **文件表格** - 添加可排序、可筛选、可编辑的文件列表视图
2. **批量编辑** - 支持手动编辑建议名称并自动重新计算状态
3. **历史记录** - 保存改名历史，支持查看和导出
4. **更多 LLM** - 支持更多 LLM 提供商（Claude、Gemini 等）
5. **递归扫描** - 可选支持子目录递归扫描
6. **打包发布** - 生成 Windows 安装包（NSIS）

## 开发命令

```bash
# 开发模式
pnpm tauri dev

# 构建前端
pnpm build:frontend

# 构建应用
pnpm build

# 运行测试
cargo test --manifest-path src-tauri/Cargo.toml --lib
pnpm test
```

## 注意事项

- API Key 明文保存在本机应用配置目录
- 仅支持 Windows 系统（回收站功能）
- 需要联网访问 LLM API
- 文件移入回收站后无法从程序内恢复
