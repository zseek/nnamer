import { useEffect, useState } from 'react';
import { useAppStore } from './store';
import { saveSettings } from './shared/lib/api';
import type { AppSettings } from './shared/types';

const styles: { [key: string]: React.CSSProperties } = {
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.48)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    width: '760px',
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: '88vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    background: 'hsl(var(--color-surface))',
    border: '1px solid hsl(var(--color-border))',
    borderRadius: '7px',
    boxShadow: '0 16px 40px rgba(15, 23, 42, 0.2)',
  },
  header: {
    flexShrink: 0,
    padding: '13px 18px',
    borderBottom: '1px solid hsl(var(--color-border))',
    fontSize: '14px',
    fontWeight: 600,
  },
  content: {
    minHeight: 0,
    padding: '16px 18px',
    overflowY: 'auto',
  },
  input: {
    width: '100%',
    height: '32px',
    padding: '5px 9px',
    border: '1px solid hsl(var(--color-border))',
    borderRadius: '4px',
    background: 'hsl(var(--color-surface))',
    color: 'hsl(var(--color-text))',
    fontSize: '12px',
  },
  textarea: {
    width: '100%',
    minHeight: '120px',
    maxHeight: '300px',
    padding: '7px 9px',
    resize: 'vertical',
    border: '1px solid hsl(var(--color-border))',
    borderRadius: '4px',
    fontFamily: 'monospace',
    fontSize: '11px',
    lineHeight: '1.4',
  },
  sectionTitle: {
    marginBottom: '6px',
    color: 'hsl(var(--color-text))',
    fontSize: '12px',
    fontWeight: 600,
  },
  formatExample: {
    marginTop: '6px',
    padding: '7px 9px',
    borderRadius: '4px',
    background: 'hsl(var(--color-background))',
    fontFamily: 'monospace',
    fontSize: '11px',
    lineHeight: '1.4',
    whiteSpace: 'pre-wrap',
  },
  footer: {
    flexShrink: 0,
    padding: '10px 18px',
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    borderTop: '1px solid hsl(var(--color-border))',
    background: 'hsl(var(--color-surface))',
  },
};

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveSuccess: () => void;
  onSaveError: (errorMessage: string) => void;
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
]`;

export default function SettingsDialog({
  isOpen,
  onClose,
  onSaveSuccess,
  onSaveError,
}: SettingsDialogProps) {
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
      concurrency: 3,
    }
  );

  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen && settings) {
      setFormData(settings);
      setIsSaving(false);
    }
  }, [isOpen, settings]);

  const handleClose = () => {
    if (isSaving) {
      return;
    }

    onClose();
  };

  const handleSave = async () => {
    setIsSaving(true);

    try {
      const savedSettings = await saveSettings(formData);
      setSettings(savedSettings);
      setFormData(savedSettings);
      onSaveSuccess();
    } catch (error) {
      onSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleOverlayClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget) {
      handleClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div style={styles.overlay} onClick={handleOverlayClick}>
      <div
        style={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-dialog-title"
      >
        <div id="settings-dialog-title" style={styles.header}>设置</div>
        
        <div style={styles.content}>
          <section className="settings-section" aria-labelledby="settings-service-title">
            <div className="settings-section-heading">
              <div id="settings-service-title" className="settings-section-title">
                模型服务
              </div>
              <div className="settings-section-description">
                OpenAI 兼容的接口地址、凭据和模型
              </div>
            </div>

            <div className="settings-service-grid">
              <label className="settings-field settings-field-wide">
                <span className="settings-field-label">API 端点</span>
                <input
                  type="text"
                  className="settings-input"
                  style={styles.input}
                  value={formData.baseUrl}
                  onChange={(event) => setFormData({
                    ...formData,
                    baseUrl: event.target.value,
                  })}
                  placeholder="https://api.openai.com/v1"
                  spellCheck={false}
                  autoComplete="off"
                />
                <span className="settings-field-hint">OpenAI 兼容接口的基础地址</span>
              </label>

              <label className="settings-field">
                <span className="settings-field-label">API Key</span>
                <input
                  type="password"
                  className="settings-input"
                  style={styles.input}
                  value={formData.apiKey}
                  onChange={(event) => setFormData({
                    ...formData,
                    apiKey: event.target.value,
                  })}
                  placeholder="sk-..."
                  spellCheck={false}
                  autoComplete="new-password"
                />
              </label>

              <label className="settings-field">
                <span className="settings-field-label">模型名称</span>
                <input
                  type="text"
                  className="settings-input"
                  style={styles.input}
                  value={formData.model}
                  onChange={(event) => setFormData({
                    ...formData,
                    model: event.target.value,
                  })}
                  placeholder="gpt-4o-mini"
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
            </div>
          </section>

          <section className="settings-section" aria-labelledby="settings-analysis-title">
            <div className="settings-section-heading">
              <div id="settings-analysis-title" className="settings-section-title">
                分析参数
              </div>
              <div className="settings-section-description">
                控制单批规模、失败重试和同时请求数量
              </div>
            </div>

            <div className="settings-parameter-grid">
              <label className="settings-parameter-field">
                <span className="settings-field-label">批次大小</span>
                <input
                  type="number"
                  className="settings-input settings-number-input"
                  style={styles.input}
                  value={formData.batchSize}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => setFormData({
                    ...formData,
                    batchSize: Number.parseInt(event.target.value, 10) || 1,
                  })}
                  min="1"
                />
                <span className="settings-field-hint">每次请求包含的文件数量</span>
              </label>

              <label className="settings-parameter-field">
                <span className="settings-field-label">重试次数</span>
                <input
                  type="number"
                  className="settings-input settings-number-input"
                  style={styles.input}
                  value={formData.maxRetries}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => setFormData({
                    ...formData,
                    maxRetries: Number.parseInt(event.target.value, 10) || 0,
                  })}
                  min="0"
                />
                <span className="settings-field-hint">请求失败后的额外重试次数</span>
              </label>

              <label className="settings-parameter-field">
                <span className="settings-field-label">并发数</span>
                <input
                  type="number"
                  className="settings-input settings-number-input"
                  style={styles.input}
                  value={formData.concurrency}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => setFormData({
                    ...formData,
                    concurrency: Number.parseInt(event.target.value, 10) || 1,
                  })}
                  min="1"
                />
                <span className="settings-field-hint">同时执行的批次数量</span>
              </label>

              <label className="settings-parameter-field">
                <span className="settings-field-label">请求超时</span>
                <input
                  type="number"
                  className="settings-input settings-number-input"
                  style={styles.input}
                  value={formData.timeoutSeconds}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => setFormData({
                    ...formData,
                    timeoutSeconds: Number.parseInt(event.target.value, 10) || 1,
                  })}
                  min="1"
                />
                <span className="settings-field-hint">单次请求超时时间（秒）</span>
              </label>
            </div>
          </section>

          <section className="settings-section settings-prompt-section">
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
              className="settings-prompt-input"
              style={styles.textarea}
              value={formData.prompt}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
            />

            <div style={{ marginTop: '10px' }}>
              <div style={styles.sectionTitle}>输入格式</div>
              <div className="selectable-text" style={styles.formatExample}>
{`[
  {"id": "b8c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e", "filename": "[笔趣阁]诡秘之主(全本)作者爱潜水的乌贼"},
  {"id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d", "filename": "斗破苍穹-天蚕土豆【完结】"}
]`}
              </div>
            </div>

            <div style={{ marginTop: '10px' }}>
              <div style={styles.sectionTitle}>期待输出格式</div>
              <div className="selectable-text" style={styles.formatExample}>
{`[
  {"id": "b8c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e", "suggested_name": "诡秘之主"},
  {"id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d", "suggested_name": "斗破苍穹"}
]`}
              </div>
            </div>
          </section>
        </div>

        <div style={styles.footer}>
          <button className="btn" onClick={handleClose} disabled={isSaving}>
            取消
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? '保存中...' : '保存设置'}
          </button>
        </div>
      </div>
    </div>
  );
}
