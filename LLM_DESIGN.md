# LLM 输入输出设计文档

## 🎯 设计目标

批量处理文件名，从混乱的文件名中提取正确的书名，支持一次性发送多个文件并返回结构化结果。

## 📋 输入设计

### 用户提示词 (System Prompt)

完整的系统提示词包含三部分：

```
你是一个专业的文件名识别工具。你的任务是从混乱的文件名中提取出正确的小说书名。

**处理规则：**
1. 去除所有无关信息：作者名、网站名、下载来源、完结标记、章节范围、更新日期、括号内广告
2. 提取核心书名：只保留小说的正式名称
3. 不要臆造：如果无法确定书名，返回原文件名

**输出格式要求：**
必须严格返回 JSON 数组格式，每个对象包含两个字段：
- "id": 文件的唯一标识符（与输入完全一致）
- "suggested_name": 识别出的书名（纯文本，不含扩展名）

**输入输出示例：**
输入格式：
[
  {"id": "b8c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e", "filename": "[笔趣阁]诡秘之主(全本)作者爱潜水的乌贼"},
  {"id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d", "filename": "斗破苍穹-天蚕土豆【完结】"}
]
输出格式：
[
  {"id": "b8c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e", "suggested_name": "诡秘之主"},
  {"id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d", "suggested_name": "斗破苍穹"}
]
```

### 文件列表格式

```rust
fn build_batch_prompt(user_rules: &str, requests: &[AnalysisRequest]) -> String {
    let file_list = requests
        .iter()
        .map(|request| format!("- ID: {}\n  文件名: {}", request.file_id, request.original_stem))
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        r#"{}

以下是需要分析的文件名：

{}

请返回 JSON 数组，每项包含 "id" 和 "suggested_name" 字段。id 必须与输入完全对应，suggested_name 为识别出的小说书名（不含 .txt 扩展名）。必须包含所有文件，不得遗漏。

示例格式：
[
  {{"id": "file-0001", "suggested_name": "诡秘之主"}},
  {{"id": "file-0002", "suggested_name": "斗破苍穹"}}
]

只返回 JSON 数组，不要其他内容。"#,
        user_rules, file_list
    )
}
```

### 实际发送的完整 Prompt 示例

```
你是一个专业的文件名识别工具。你的任务是从混乱的文件名中提取出正确的小说书名。

**处理规则：**
1. 去除所有无关信息：作者名、网站名、下载来源、完结标记、章节范围、更新日期、括号内广告
2. 提取核心书名：只保留小说的正式名称
3. 不要臆造：如果无法确定书名，返回原文件名

**输出格式要求：**
必须严格返回 JSON 数组格式，每个对象包含两个字段：
- "id": 文件的唯一标识符（与输入完全一致）
- "suggested_name": 识别出的书名（纯文本，不含扩展名）

**输入输出示例：**
输入格式：
[
  {"id": "b8c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e", "filename": "[笔趣阁]诡秘之主(全本)作者爱潜水的乌贼"},
  {"id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d", "filename": "斗破苍穹-天蚕土豆【完结】"}
]
输出格式：
[
  {"id": "b8c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e", "suggested_name": "诡秘之主"},
  {"id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d", "suggested_name": "斗破苍穹"}
]

以下是需要分析的文件名：

- ID: file-00001
  文件名: [笔趣阁]诡秘之主(全本)作者爱潜水的乌贼
- ID: file-00002
  文件名: 斗破苍穹-天蚕土豆【完结】
- ID: file-00003
  文件名: 遮天(辰东)更新至2024-01-15

请返回 JSON 数组，每项包含 "id" 和 "suggested_name" 字段。id 必须与输入完全对应，suggested_name 为识别出的小说书名（不含 .txt 扩展名）。必须包含所有文件，不得遗漏。

示例格式：
[
  {"id": "file-0001", "suggested_name": "诡秘之主"},
  {"id": "file-0002", "suggested_name": "斗破苍穹"}
]

只返回 JSON 数组，不要其他内容。
```

## 📤 输出设计

### 期望的 LLM 返回格式

```json
[
  {"id": "file-00001", "suggested_name": "诡秘之主"},
  {"id": "file-00002", "suggested_name": "斗破苍穹"},
  {"id": "file-00003", "suggested_name": "遮天"}
]
```

### 兼容的返回格式

LLM 可能会用 markdown 代码块包裹 JSON：

```
```json
[
  {"id": "file-00001", "suggested_name": "诡秘之主"}
]
```
```

或者：

```
```
[
  {"id": "file-00001", "suggested_name": "诡秘之主"}]
```
```

我们的解析器会自动去除这些包裹。

## 🔧 解析与匹配逻辑

### 1. 响应解析

```rust
fn parse_completion_response(
    batch_index: usize,
    requests: &[AnalysisRequest],
    response_text: &str,
) -> AppResult<BatchAnalysisResult> {
    // 1. 解析 OpenAI API 响应
    let response_json: Value = serde_json::from_str(response_text)?;
    let content = response_json["choices"][0]["message"]["content"].as_str()?;

    // 2. 去除 markdown 代码块包裹
    let trimmed_content = content.trim();
    let json_content = if trimmed_content.starts_with("```json") {
        trimmed_content
            .strip_prefix("```json")
            .and_then(|s| s.strip_suffix("```"))
            .unwrap_or(trimmed_content)
            .trim()
    } else if trimmed_content.starts_with("```") {
        trimmed_content
            .strip_prefix("```")
            .and_then(|s| s.strip_suffix("```"))
            .unwrap_or(trimmed_content)
            .trim()
    } else {
        trimmed_content
    };

    // 3. 解析 JSON 数组
    let suggestions: Vec<LlmSuggestion> = serde_json::from_str(json_content)?;
    
    // ...
}
```

### 2. ID 匹配

```rust
// 构建 ID -> 书名的映射
let suggestion_map: HashMap<String, String> = suggestions
    .into_iter()
    .map(|s| (s.id, s.suggested_name))
    .collect();

// 为每个输入文件生成结果
let mut results = Vec::new();
for request in requests {
    let analysis_result = if let Some(suggested_name) = suggestion_map.get(&request.file_id) {
        // 找到对应的建议名称
        let validation = naming::normalize_suggested_name(suggested_name);
        AnalysisResult {
            file_id: request.file_id.clone(),
            suggested_name: Some(suggested_name.clone()),
            normalized_name: validation.normalized_name,
            error: validation.error,
        }
    } else {
        // LLM 未返回此文件
        AnalysisResult {
            file_id: request.file_id.clone(),
            suggested_name: None,
            normalized_name: None,
            error: Some("LLM 响应中缺少此文件".to_string()),
        }
    };
    results.push(analysis_result);
}
```

### 3. 文件名验证与规范化

```rust
// src-tauri/src/naming.rs
pub fn normalize_suggested_name(suggested_name: &str) -> ValidationResult {
    // 检查是否包含 Windows 非法字符
    let illegal_chars = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    
    if suggested_name.chars().any(|c| illegal_chars.contains(&c)) {
        return ValidationResult {
            normalized_name: None,
            error: Some("包含非法字符".to_string()),
        };
    }
    
    // 去除前后空格
    let trimmed = suggested_name.trim();
    
    if trimmed.is_empty() {
        return ValidationResult {
            normalized_name: None,
            error: Some("书名为空".to_string()),
        };
    }
    
    ValidationResult {
        normalized_name: Some(trimmed.to_string()),
        error: None,
    }
}
```

## 🔄 完整流程

```
1. 用户选择文件
   ↓
2. 前端扫描目录，获取文件列表
   ↓
3. 前端发起批量分析请求
   每批 10-20 个文件（可配置），支持 1-10 个批次并发执行
   ↓
4. Rust 后端构建完整 Prompt
   = 系统提示词 + 文件列表 + 格式要求
   ↓
5. 调用 OpenAI API
   POST /v1/chat/completions
   {
     "model": "gpt-4o-mini",
     "messages": [{"role": "user", "content": "..."}],
     "temperature": 0.3
   }
   ↓
6. 解析 LLM 响应
   - 提取 content 字段
   - 去除 markdown 包裹
   - 解析 JSON 数组
   ↓
7. ID 匹配 & 验证
   - 通过 ID 匹配每个文件的建议名称
   - 验证文件名合法性
   - 规范化为不含扩展名的名称主干
   ↓
8. 返回前端
   {
     "batchIndex": 0,
     "results": [
       {
         "fileId": "file-00001",
         "suggestedName": "诡秘之主",
         "normalizedName": "诡秘之主",
         "error": null
       }
     ]
   }
   ↓
9. 前端更新 UI
   显示建议文件名，用户可编辑
   ↓
10. 用户确认后执行重命名
```

## ⚠️ 错误处理

### LLM 返回格式错误

- 无法解析 JSON → 整批失败，显示"批次失败"
- 缺少某些文件 ID → 该文件显示"LLM 响应中缺少此文件"
- ID 不匹配 → 忽略，不影响其他文件

### 文件名验证失败

- 建议名称为空或无法规范化 → `status: failed`，并保留具体错误信息
- Windows 保留设备名 → `status: failed`，并提示用户修改
- 用户修改建议文件名后立即重新校验；有效且无冲突时，根据是否与源名称一致自动变为 `ready` 或 `unchanged`

### 网络错误

- 超时或其他可重试错误 → 按设置重试 0-5 次
- HTTP 错误 → 记录状态码和响应，显示给用户

## 📊 数据结构

### 前端 → 后端

```typescript
interface AnalysisRequest {
  fileId: string;        // "file-00001"
  originalStem: string;  // 不含扩展名的文件名
}
```

### 后端 → 前端

```rust
struct AnalysisResult {
    file_id: String,
    suggested_name: Option<String>,      // LLM 原始返回
    normalized_name: Option<String>,     // 验证后的规范文件名
    error: Option<String>,               // 错误信息
}

struct BatchAnalysisResult {
    batch_index: usize,
    results: Vec<AnalysisResult>,
    raw_response: Option<String>,        // 完整的 API 响应（调试用）
}
```

## 🎨 提示词设计理念

1. **明确角色**："你是一个专业的文件名识别工具"
2. **详细规则**：列出所有需要去除的内容
3. **格式约束**：用 markdown 加粗 + 示例强化 JSON 格式要求
4. **容错指导**："不要臆造" → 防止 LLM 胡乱猜测
5. **重复强调**：多次提及"必须返回 JSON"、"不要遗漏文件"

## 🔧 可配置项

用户可在设置中修改：

- **API 端点**：支持 OpenAI 兼容的 API
- **模型**：gpt-4o-mini、claude-3-5-sonnet 等
- **批次大小**：10-20 个文件/批次
- **并发数**：同时执行 1-10 个批次请求
- **系统提示词**：完全自定义（带重置按钮）
- **超时时间**：5-300 秒
- **重试次数**：每批首次请求失败后重试 0-5 次

---

**设计版本**: v1.0  
**最后更新**: 2025-01-17
