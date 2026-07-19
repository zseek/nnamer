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

### 消息结构

系统提示词与每批文件数据分成两条 message，不能拼接成一个字符串：

```rust
fn build_batch_messages(
    system_prompt: &str,
    requests: &[AnalysisRequest],
) -> AppResult<Vec<ChatMessage>> {
    let file_inputs = requests
        .iter()
        .map(|request| FilePromptInput {
            id: request.file_id.clone(),
            filename: naming::strip_txt_extension(&request.original_stem),
        })
        .collect::<Vec<_>>();
    let file_inputs_json = serde_json::to_string_pretty(&file_inputs)?;

    Ok(vec![
        ChatMessage {
            role: "system",
            content: system_prompt.to_string(),
        },
        ChatMessage {
            role: "user",
            content: file_inputs_json,
        },
    ])
}
```

实际请求体的 `messages` 字段结构如下：

```json
[
  {
    "role": "system",
    "content": "这里是设置中保存的提示词，原样发送，不追加任何内容"
  },
  {
    "role": "user",
    "content": "这里是当前批次的文件 JSON 数组"
  }
]
```

第一条 message 在所有批次之间保持不变，第二条 message 只包含当前批次数据。这样可以让模型服务更容易复用稳定前缀缓存，也避免文件数据破坏提示词结构。

文件 JSON 只负责承载输入数据，不在其中追加输出格式说明或其他行为指令：

```json
[
  {
    "id": "file-00001",
    "filename": "[笔趣阁]诡秘之主(全本)作者爱潜水的乌贼"
  },
  {
    "id": "file-00002",
    "filename": "斗破苍穹-天蚕土豆【完结】"
  }
]
```

应用不会在用户提示词后面自动追加“请返回 JSON 数组”等内容。输出约束应由用户在设置中的提示词自行定义，默认提示词已经包含这部分规则。

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
   批次大小和同时执行的批次数量均可配置
   ↓
4. Rust 后端构造两条独立 message
   - 第一条：设置中的系统提示词，原样发送
   - 第二条：当前批次的文件 JSON 数组
   - 不拼接额外输出要求
   ↓
5. 调用 OpenAI API
   POST /v1/chat/completions
   {
     "model": "gpt-4o-mini",
     "messages": [
       {"role": "system", "content": "用户设置的提示词"},
       {"role": "user", "content": "当前批次文件 JSON"}
     ],
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

- 超时或其他可重试错误 → 按设置的重试次数执行
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
- **批次大小**：每个请求包含的文件数量
- **并发数**：同时执行的批次请求数量
- **系统提示词**：完全自定义（带重置按钮）
- **超时时间**：单次请求超时时间（秒）
- **重试次数**：每批首次请求失败后的额外重试次数

---

**设计版本**: v1.0  
**最后更新**: 2025-01-17
