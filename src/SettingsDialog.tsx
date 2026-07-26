import { useEffect, useState } from 'react';
import { useAppStore } from './store';
import { saveSettings } from './shared/lib/api';
import type { AppSettings, PromptProfile } from './shared/types';

const styles: { [key: string]: React.CSSProperties } = {
  overlay: {
    position: 'fixed',
    inset: 0,
    padding: '20px',
    background: 'rgba(15, 23, 42, 0.48)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  dialog: {
    width: 'min(1080px, calc(100vw - 40px))',
    height: 'min(720px, calc(100vh - 40px))',
    minHeight: '420px',
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
    flex: 1,
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

const DEFAULT_PROMPT_PROFILE_ID = 'default';
const DEFAULT_PROMPT_PROFILE_NAME = '小说书名识别';

function createDefaultPromptProfile(): PromptProfile {
  return {
    id: DEFAULT_PROMPT_PROFILE_ID,
    name: DEFAULT_PROMPT_PROFILE_NAME,
    content: DEFAULT_PROMPT,
  };
}

function createInitialSettings(): AppSettings {
  const defaultPromptProfile = createDefaultPromptProfile();

  return {
    baseUrl: '',
    apiKey: '',
    model: 'gpt-4o-mini',
    prompt: defaultPromptProfile.content,
    promptProfiles: [defaultPromptProfile],
    activePromptId: defaultPromptProfile.id,
    batchSize: 15,
    timeoutSeconds: 60,
    maxRetries: 2,
    concurrency: 3,
  };
}

function normalizePromptProfiles(settings: AppSettings): AppSettings {
  const promptProfiles = settings.promptProfiles ?? [];
  if (promptProfiles.length === 0) {
    const migratedPromptProfile: PromptProfile = {
      id: DEFAULT_PROMPT_PROFILE_ID,
      name: DEFAULT_PROMPT_PROFILE_NAME,
      content: settings.prompt || DEFAULT_PROMPT,
    };

    return {
      ...settings,
      prompt: migratedPromptProfile.content,
      promptProfiles: [migratedPromptProfile],
      activePromptId: migratedPromptProfile.id,
    };
  }

  const activePromptProfile = promptProfiles.find(
    (promptProfile) => promptProfile.id === settings.activePromptId
  ) ?? promptProfiles[0];

  return {
    ...settings,
    prompt: activePromptProfile.content,
    activePromptId: activePromptProfile.id,
  };
}

export default function SettingsDialog({
  isOpen,
  onClose,
  onSaveSuccess,
  onSaveError,
}: SettingsDialogProps) {
  const { settings, setSettings } = useAppStore();
  const [formData, setFormData] = useState<AppSettings>(() =>
    normalizePromptProfiles(settings ?? createInitialSettings())
  );

  const [isSaving, setIsSaving] = useState(false);
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false);

  useEffect(() => {
    if (isOpen && settings) {
      setFormData(normalizePromptProfiles(settings));
      setIsSaving(false);
      setIsApiKeyVisible(false);
    }
  }, [isOpen, settings]);

  const activePromptProfile = formData.promptProfiles.find(
    (promptProfile) => promptProfile.id === formData.activePromptId
  ) ?? formData.promptProfiles[0];

  const updateActivePromptProfile = (
    updates: Partial<Pick<PromptProfile, 'name' | 'content'>>
  ) => {
    setFormData((currentFormData) => {
      const nextPromptProfiles = currentFormData.promptProfiles.map(
        (promptProfile) => promptProfile.id === currentFormData.activePromptId
          ? { ...promptProfile, ...updates }
          : promptProfile
      );
      const nextPrompt = updates.content ?? currentFormData.prompt;

      return {
        ...currentFormData,
        prompt: nextPrompt,
        promptProfiles: nextPromptProfiles,
      };
    });
  };

  const handleSelectPromptProfile = (promptProfileId: string) => {
    setFormData((currentFormData) => {
      const selectedPromptProfile = currentFormData.promptProfiles.find(
        (promptProfile) => promptProfile.id === promptProfileId
      );
      if (!selectedPromptProfile) {
        return currentFormData;
      }

      return {
        ...currentFormData,
        prompt: selectedPromptProfile.content,
        activePromptId: selectedPromptProfile.id,
      };
    });
  };

  const handleAddPromptProfile = () => {
    const promptProfileId = crypto.randomUUID();
    const newPromptProfile: PromptProfile = {
      id: promptProfileId,
      name: `新提示词 ${formData.promptProfiles.length + 1}`,
      content: activePromptProfile?.content ?? DEFAULT_PROMPT,
    };

    setFormData((currentFormData) => ({
      ...currentFormData,
      prompt: newPromptProfile.content,
      promptProfiles: [...currentFormData.promptProfiles, newPromptProfile],
      activePromptId: newPromptProfile.id,
    }));
  };

  const handleDeletePromptProfile = () => {
    if (formData.promptProfiles.length <= 1) {
      return;
    }

    setFormData((currentFormData) => {
      const activePromptIndex = currentFormData.promptProfiles.findIndex(
        (promptProfile) => promptProfile.id === currentFormData.activePromptId
      );
      const nextPromptProfiles = currentFormData.promptProfiles.filter(
        (promptProfile) => promptProfile.id !== currentFormData.activePromptId
      );
      const nextActivePromptProfile = nextPromptProfiles[
        Math.min(Math.max(activePromptIndex, 0), nextPromptProfiles.length - 1)
      ];

      return {
        ...currentFormData,
        prompt: nextActivePromptProfile.content,
        promptProfiles: nextPromptProfiles,
        activePromptId: nextActivePromptProfile.id,
      };
    });
  };

  const handleResetActivePrompt = () => {
    updateActivePromptProfile({ content: DEFAULT_PROMPT });
  };

  const handleClose = () => {
    if (isSaving) {
      return;
    }

    onClose();
  };

  const handleSave = async () => {
    const normalizedPromptProfiles = formData.promptProfiles.map(
      (promptProfile) => ({
        ...promptProfile,
        name: promptProfile.name.trim(),
      })
    );
    const normalizedActivePromptProfile = normalizedPromptProfiles.find(
      (promptProfile) => promptProfile.id === formData.activePromptId
    );

    if (normalizedPromptProfiles.some(
      (promptProfile) => !promptProfile.name || !promptProfile.content.trim()
    )) {
      onSaveError('提示词名称和内容均不能为空');
      return;
    }

    if (!normalizedActivePromptProfile) {
      onSaveError('当前提示词不存在，请重新选择');
      return;
    }

    setIsSaving(true);

    try {
      const savedSettings = await saveSettings({
        ...formData,
        prompt: normalizedActivePromptProfile.content,
        promptProfiles: normalizedPromptProfiles,
      });
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

              <div className="settings-field">
                <label className="settings-field-label" htmlFor="settings-api-key">
                  API Key
                </label>
                <div className="settings-secret-input-wrapper">
                  <input
                    id="settings-api-key"
                    type={isApiKeyVisible ? 'text' : 'password'}
                    className="settings-input settings-secret-input"
                    style={{ ...styles.input, paddingRight: '38px' }}
                    value={formData.apiKey}
                    onChange={(event) => setFormData({
                      ...formData,
                      apiKey: event.target.value,
                    })}
                    placeholder="sk-..."
                    spellCheck={false}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="settings-secret-toggle"
                    aria-label={isApiKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                    aria-pressed={isApiKeyVisible}
                    title={isApiKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                    onClick={() => setIsApiKeyVisible((isVisible) => !isVisible)}
                  >
                    {isApiKeyVisible ? (
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3 3l18 18" />
                        <path d="M10.6 10.7a2 2 0 0 0 2.7 2.7" />
                        <path d="M9.9 4.2A10.7 10.7 0 0 1 12 4c5.2 0 8.5 4.5 9 6.1a2.6 2.6 0 0 1 0 1.8 10.3 10.3 0 0 1-2 3.3" />
                        <path d="M6.2 6.2A11.5 11.5 0 0 0 3 10.1a2.6 2.6 0 0 0 0 1.8C3.5 13.5 6.8 18 12 18a10 10 0 0 0 3.1-.5" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M3 10.1C3.5 8.5 6.8 4 12 4s8.5 4.5 9 6.1a2.6 2.6 0 0 1 0 1.8C20.5 13.5 17.2 18 12 18s-8.5-4.5-9-6.1a2.6 2.6 0 0 1 0-1.8Z" />
                        <circle cx="12" cy="11" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

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

          <section
            className="settings-section settings-prompt-section"
            aria-labelledby="settings-prompt-title"
          >
            <div className="settings-section-heading settings-prompt-heading">
              <div id="settings-prompt-title" className="settings-section-title">
                提示词
              </div>
              <div className="settings-section-description">
                保存多套任务指令，当前选中的提示词会用于下一次分析
              </div>
            </div>

            <div className="settings-prompt-workspace">
              <aside className="settings-prompt-library" aria-label="已保存的提示词">
                <div className="settings-prompt-library-header">
                  <div>
                    <div className="settings-prompt-library-title">提示词库</div>
                    <div className="settings-prompt-library-count">
                      {formData.promptProfiles.length} 套配置
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn settings-prompt-add-button"
                    onClick={handleAddPromptProfile}
                    title="基于当前内容创建一套新提示词"
                  >
                    <span aria-hidden="true">+</span>
                    新建
                  </button>
                </div>

                <div className="settings-prompt-profile-list">
                  {formData.promptProfiles.map((promptProfile) => {
                    const isActive = promptProfile.id === formData.activePromptId;
                    const promptSummary = promptProfile.content
                      .split('\n')
                      .find((line) => line.trim())
                      ?.trim() ?? '暂无提示词内容';

                    return (
                      <button
                        key={promptProfile.id}
                        type="button"
                        className={`settings-prompt-profile${isActive ? ' is-active' : ''}`}
                        aria-pressed={isActive}
                        onClick={() => handleSelectPromptProfile(promptProfile.id)}
                      >
                        <span className="settings-prompt-profile-indicator" aria-hidden="true" />
                        <span className="settings-prompt-profile-copy">
                          <span className="settings-prompt-profile-name">
                            {promptProfile.name || '未命名提示词'}
                          </span>
                          <span className="settings-prompt-profile-summary">
                            {promptSummary}
                          </span>
                        </span>
                        {isActive && (
                          <span className="settings-prompt-active-label">使用中</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </aside>

              <div className="settings-prompt-editor">
                <div className="settings-prompt-editor-header">
                  <label className="settings-prompt-title-field">
                    <span className="settings-prompt-editor-kicker">编辑当前提示词</span>
                    <input
                      type="text"
                      className="settings-prompt-title-input"
                      value={activePromptProfile?.name ?? ''}
                      onChange={(event) => updateActivePromptProfile({
                        name: event.target.value,
                      })}
                      placeholder="输入提示词名称"
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </label>

                  <div className="settings-prompt-editor-actions">
                    <button
                      type="button"
                      className="btn settings-prompt-reset-button"
                      onClick={handleResetActivePrompt}
                    >
                      恢复默认内容
                    </button>
                    <button
                      type="button"
                      className="btn settings-prompt-delete-button"
                      onClick={handleDeletePromptProfile}
                      disabled={formData.promptProfiles.length <= 1}
                      title={
                        formData.promptProfiles.length <= 1
                          ? '至少需要保留一个提示词'
                          : '删除当前提示词'
                      }
                    >
                      删除
                    </button>
                  </div>
                </div>

                <div className="settings-prompt-editor-status">
                  <span className="settings-prompt-current-mark">
                    <span aria-hidden="true" />
                    下一次分析将使用此提示词
                  </span>
                  <span>{activePromptProfile?.content.length ?? 0} 个字符</span>
                </div>

                <label
                  htmlFor="settings-prompt-content"
                  className="settings-prompt-content-label"
                >
                  提示词内容
                </label>
                <textarea
                  id="settings-prompt-content"
                  className="settings-prompt-input settings-prompt-content-input"
                  style={styles.textarea}
                  value={activePromptProfile?.content ?? ''}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => updateActivePromptProfile({
                    content: event.target.value,
                  })}
                />
              </div>
            </div>

            <details className="settings-prompt-format-details">
              <summary>查看模型输入与期待输出格式</summary>
              <div className="settings-prompt-format-grid">
                <div>
                  <div className="settings-prompt-format-title">输入格式</div>
                  <div className="selectable-text" style={styles.formatExample}>
{`[
  {"id": "b8c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e", "filename": "[笔趣阁]诡秘之主(全本)作者爱潜水的乌贼"},
  {"id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d", "filename": "斗破苍穹-天蚕土豆【完结】"}
]`}
                  </div>
                </div>
                <div>
                  <div className="settings-prompt-format-title">期待输出格式</div>
                  <div className="selectable-text" style={styles.formatExample}>
{`[
  {"id": "b8c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e", "suggested_name": "诡秘之主"},
  {"id": "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d", "suggested_name": "斗破苍穹"}
]`}
                  </div>
                </div>
              </div>
            </details>
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
