import { useState, useEffect } from 'react';
import { useAppStore } from './store';
import { saveSettings } from './shared/lib/api';
import type { AppSettings } from './shared/types';

const styles: { [key: string]: React.CSSProperties } = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    background: 'hsl(var(--color-surface))',
    borderRadius: '6px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    width: '680px',
    maxHeight: '85vh',
    overflow: 'auto',
  },
  header: {
    padding: '12px 16px',
    borderBottom: '1px solid hsl(var(--color-border))',
    fontSize: '14px',
    fontWeight: 600,
  },
  content: {
    padding: '16px',
  },
  row: {
    display: 'grid',
    gridTemplateColumns: '140px 1fr',
    alignItems: 'center',
    marginBottom: '12px',
    gap: '12px',
  },
  label: {
    fontSize: '12px',
    fontWeight: 500,
    color: 'hsl(var(--color-text))',
    textAlign: 'right',
  },
  input: {
    width: '100%',
    padding: '5px 8px',
    border: '1px solid hsl(var(--color-border))',
    borderRadius: '3px',
    fontSize: '12px',
  },
  textarea: {
    width: '100%',
    padding: '6px 8px',
    border: '1px solid hsl(var(--color-border))',
    borderRadius: '3px',
    fontSize: '11px',
    fontFamily: 'monospace',
    resize: 'vertical',
    minHeight: '120px',
    maxHeight: '300px',
    lineHeight: '1.4',
  },
  section: {
    marginTop: '12px',
    paddingTop: '12px',
    borderTop: '1px solid hsl(var(--color-border))',
  },
  sectionTitle: {
    fontSize: '12px',
    fontWeight: 600,
    color: 'hsl(var(--color-text))',
    marginBottom: '6px',
  },
  formatExample: {
    fontSize: '11px',
    fontFamily: 'monospace',
    background: 'hsl(var(--color-background))',
    padding: '6px 8px',
    borderRadius: '3px',
    marginTop: '6px',
    whiteSpace: 'pre-wrap',
    lineHeight: '1.4',
  },
  footer: {
    padding: '10px 16px',
    borderTop: '1px solid hsl(var(--color-border))',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
  },
};

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_PROMPT = `你是一个专业的文件名识别工具。你的任务是从混乱的文件名中提取出正确的小说书名。

**处理规则：**
1. 去除所有无关信息：作者名、网站名、下载来源、完结标记、章节范围、更新日期、括号内广告
2. 提取核心书名：只保留小说的正式名称
3. 不要臆造：如果无法确定书名，返回原文件名

**输出格式要求：**
必须严格返回 JSON 数组格式，每个对象包含两个字段：
- "id": 文件的唯一标识符（与输入完全一致）
- "suggested_name": 识别出的书名（纯文本，不含扩展名）

**示例：**
输入文件名："[顶点小说]诡秘之主(全本)作者爱潜水的乌贼.txt"
输出：{"id": "file-001", "suggested_name": "诡秘之主"}

**重要：**
1. 必须包含所有输入文件，一个都不能遗漏
2. 只返回 JSON 数组，不要任何其他文字说明
3. 确保 JSON 格式正确可解析`;

export default function SettingsDialog({ isOpen, onClose }: SettingsDialogProps) {
  const { settings, setSettings } = useAppStore();
  const [formData, setFormData] = useState<AppSettings>(
    settings || {
      baseUrl: '',
      apiKey: '',
      model: 'gpt-4o-mini',
      prompt: DEFAULT_PROMPT,
      batchSize: 15,
      timeoutSeconds: 60,
      maxRetries: 2,
    }
  );

  useEffect(() => {
    if (isOpen && settings) {
      setFormData(settings);
    }
  }, [isOpen, settings]);

  if (!isOpen) return null;

  const handleSave = async () => {
    try {
      await saveSettings(formData);
      setSettings(formData);
      onClose();
    } catch (error) {
      alert(`保存失败：${error}`);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div style={styles.overlay} onClick={handleOverlayClick}>
      <div style={styles.dialog}>
        <div style={styles.header}>设置</div>
        
        <div style={styles.content}>
          <div style={styles.row}>
            <label style={styles.label}>API 端点 (OpenAI 兼容)</label>
            <input
              type="text"
              style={styles.input}
              value={formData.baseUrl}
              onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
          </div>

          <div style={styles.row}>
            <label style={styles.label}>API Key (身份验证)</label>
            <input
              type="password"
              style={styles.input}
              value={formData.apiKey}
              onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
              placeholder="sk-..."
            />
          </div>

          <div style={styles.row}>
            <label style={styles.label}>模型名称</label>
            <input
              type="text"
              style={styles.input}
              value={formData.model}
              onChange={(e) => setFormData({ ...formData, model: e.target.value })}
              placeholder="gpt-4o-mini / claude-3-5-sonnet"
            />
          </div>

          <div style={styles.row}>
            <label style={styles.label}>批次大小 (10-20)</label>
            <input
              type="number"
              style={styles.input}
              value={formData.batchSize}
              onChange={(e) => setFormData({ ...formData, batchSize: parseInt(e.target.value) || 15 })}
              min="10"
              max="20"
            />
          </div>

          <div style={styles.section}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={styles.sectionTitle}>系统提示词</div>
              <button 
                type="button"
                className="btn"
                style={{ padding: '2px 8px', fontSize: '11px' }}
                onClick={() => setFormData({ ...formData, prompt: DEFAULT_PROMPT })}
              >
                重置为默认
              </button>
            </div>
            <textarea
              style={styles.textarea}
              value={formData.prompt}
              onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
            />

            <div style={{ marginTop: '10px' }}>
              <div style={styles.sectionTitle}>输入格式</div>
              <div style={styles.formatExample}>
{`[
  {"id": "b8c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e", "filename": "[笔趣阁]诡秘之主(全本)作者爱潜水的乌贼"},
  {"id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d", "filename": "斗破苍穹-天蚕土豆【完结】"}
]`}
              </div>
            </div>

            <div style={{ marginTop: '10px' }}>
              <div style={styles.sectionTitle}>期待输出格式</div>
              <div style={styles.formatExample}>
{`[
  {"id": "b8c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e", "suggested_name": "诡秘之主"},
  {"id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d", "suggested_name": "斗破苍穹"}
]`}
              </div>
            </div>
          </div>
        </div>

        <div style={styles.footer}>
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
