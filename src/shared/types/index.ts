export type FileStatus =
  | 'unanalyzed'
  | 'analyzing'
  | 'normal'
  | 'nameSame'
  | 'conflict'
  | 'analysisFailed'
  | 'nameInvalid';

export interface FileItem {
  id: string;
  originalName: string;
  originalStem: string;
  sizeBytes: number;
  modifiedAt: number;
  status: FileStatus;
  suggestedName?: string;
  normalizedName?: string;
  error?: string;
  selected: boolean;
}

export interface AppSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  batchSize: number;
  timeoutSeconds: number;
  maxRetries: number;
  prompt: string;
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
  largestFileId?: string;
}
