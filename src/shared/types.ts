export type FileStatus =
  | 'pending'
  | 'analyzing'
  | 'ready'
  | 'unchanged'
  | 'renamed'
  | 'conflict'
  | 'failed';

export interface AnalysisResult {
  fileId: string;
  suggestedName?: string;
  normalizedName?: string;
  error?: string;
}

export interface BatchAnalysisResult {
  batchIndex: number;
  results: AnalysisResult[];
  rawResponse?: string;
}

export interface ScannedFile {
  id: string;
  originalName: string;
  originalStem: string;
  sizeBytes: number;
  modifiedAt: number;
}

export interface FileItem {
  id: string;
  originalName: string;
  originalStem: string;
  sizeBytes: number;
  modifiedAt: number;
  status: FileStatus;
  hasBeenRenamed?: boolean;
  suggestedName?: string;
  normalizedName?: string;
  analysisSessionId?: string;
  error?: string;
}

export interface PromptProfile {
  id: string;
  name: string;
  content: string;
}

export type ImportFileType = 'txt' | 'epub';

export interface AppSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  importFileType: ImportFileType;
  batchSize: number;
  timeoutSeconds: number;
  maxRetries: number;
  concurrency: number;
  prompt: string;
  promptProfiles: PromptProfile[];
  activePromptId: string;
}

export interface RecycleBinOperation {
  fileId: string;
  originalName: string;
  sizeBytes: number;
  modifiedAt: number;
}

export interface FileOperationResult {
  fileId: string;
  success: boolean;
  error?: string;
}

export type RenameResult = FileOperationResult;

export interface RenameOperation {
  fileId: string;
  originalName: string;
  targetName: string;
}

export interface AnalysisProgress {
  totalBatches: number;
  completedBatches: number;
  failedBatches: number;
  isRunning: boolean;
}

export interface ConflictGroup {
  normalizedName: string;
  files: FileItem[];
  /** 自动清理时保留的文件；大小相同时也会确定性选出一个。 */
  largestFileId: string;
}

export interface ResolvableConflictGroup {
  normalizedName: string;
  retainedFile: FileItem;
  filesToRemove: FileItem[];
}

export interface ConflictCleanupPlan {
  resolvableGroups: ResolvableConflictGroup[];
  skippedGroups: ConflictGroup[];
  filesToRemove: FileItem[];
}
