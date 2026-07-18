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
  selected: boolean;
  hasBeenRenamed?: boolean;
  suggestedName?: string;
  normalizedName?: string;
  error?: string;
}

export interface AppSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  batchSize: number;
  timeoutSeconds: number;
  maxRetries: number;
  concurrency: number;
  prompt: string;
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

export interface AnalysisProgress {
  totalBatches: number;
  completedBatches: number;
  failedBatches: number;
  isRunning: boolean;
  isPaused: boolean;
}

export interface ConflictGroup {
  normalizedName: string;
  files: FileItem[];
  largestFileId?: string;
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
