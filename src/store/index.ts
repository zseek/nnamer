import { create } from 'zustand';
import type { FileItem, AppSettings, AnalysisProgress } from '../shared/types';

export interface FileOperationProgress {
  kind: 'rename' | 'conflict-cleanup';
  completed: number;
  total: number;
  failed: number;
}

interface AppStore {
  currentDirectory: string | null;
  files: FileItem[];
  selectedFileIds: ReadonlySet<string>;
  settings: AppSettings | null;
  analysisProgress: AnalysisProgress;
  fileOperationProgress: FileOperationProgress | null;
  showLogger: boolean;

  setCurrentDirectory: (directory: string | null) => void;
  setFiles: (files: FileItem[] | ((prev: FileItem[]) => FileItem[])) => void;
  updateFile: (id: string, updates: Partial<FileItem>) => void;
  removeFiles: (ids: string[]) => void;
  setFileSelected: (fileId: string, isSelected: boolean) => void;
  toggleFileSelection: (fileId: string) => void;
  selectFileIds: (fileIds: Iterable<string>) => void;
  setSelectedFileIds: (fileIds: Iterable<string>) => void;
  clearSelection: () => void;
  clearSelectionForIds: (fileIds: Iterable<string>) => void;
  setSettings: (settings: AppSettings) => void;
  setAnalysisProgress: (
    progress:
      | Partial<AnalysisProgress>
      | ((prev: AnalysisProgress) => Partial<AnalysisProgress>)
  ) => void;
  setFileOperationProgress: (progress: FileOperationProgress | null) => void;
  setShowLogger: (show: boolean) => void;
  clearFiles: () => void;
}

function createSelectedFileIdSet(fileIds: Iterable<string>): ReadonlySet<string> {
  return new Set(fileIds);
}

export const useAppStore = create<AppStore>((set) => ({
  currentDirectory: null,
  files: [],
  selectedFileIds: new Set(),
  settings: null,
  analysisProgress: {
    totalBatches: 0,
    completedBatches: 0,
    failedBatches: 0,
    isRunning: false,
  },
  fileOperationProgress: null,
  showLogger: false,

  setCurrentDirectory: (directory) => set({ currentDirectory: directory }),

  setFiles: (files) =>
    set((state) => {
      const nextFiles = typeof files === 'function' ? files(state.files) : files;
      if (nextFiles === state.files) {
        return state;
      }

      if (state.selectedFileIds.size === 0) {
        return { files: nextFiles };
      }

      const existingFileIds = new Set(nextFiles.map((file) => file.id));
      let didDropMissingSelection = false;
      const nextSelectedFileIds = new Set<string>();

      for (const selectedFileId of state.selectedFileIds) {
        if (existingFileIds.has(selectedFileId)) {
          nextSelectedFileIds.add(selectedFileId);
        } else {
          didDropMissingSelection = true;
        }
      }

      return {
        files: nextFiles,
        selectedFileIds: didDropMissingSelection
          ? nextSelectedFileIds
          : state.selectedFileIds,
      };
    }),

  updateFile: (id, updates) =>
    set((state) => ({
      files: state.files.map((file) =>
        file.id === id ? { ...file, ...updates } : file
      ),
    })),

  removeFiles: (ids) =>
    set((state) => {
      const removedFileIds = new Set(ids);
      const nextSelectedFileIds = new Set(
        [...state.selectedFileIds].filter(
          (selectedFileId) => !removedFileIds.has(selectedFileId)
        )
      );

      return {
        files: state.files.filter((file) => !removedFileIds.has(file.id)),
        selectedFileIds:
          nextSelectedFileIds.size === state.selectedFileIds.size
            ? state.selectedFileIds
            : nextSelectedFileIds,
      };
    }),

  setFileSelected: (fileId, isSelected) =>
    set((state) => {
      const isCurrentlySelected = state.selectedFileIds.has(fileId);
      if (isCurrentlySelected === isSelected) {
        return state;
      }

      const nextSelectedFileIds = new Set(state.selectedFileIds);
      if (isSelected) {
        nextSelectedFileIds.add(fileId);
      } else {
        nextSelectedFileIds.delete(fileId);
      }

      return { selectedFileIds: nextSelectedFileIds };
    }),

  toggleFileSelection: (fileId) =>
    set((state) => {
      const nextSelectedFileIds = new Set(state.selectedFileIds);
      if (nextSelectedFileIds.has(fileId)) {
        nextSelectedFileIds.delete(fileId);
      } else {
        nextSelectedFileIds.add(fileId);
      }

      return { selectedFileIds: nextSelectedFileIds };
    }),

  selectFileIds: (fileIds) =>
    set((state) => {
      let didAddSelection = false;
      const nextSelectedFileIds = new Set(state.selectedFileIds);

      for (const fileId of fileIds) {
        if (!nextSelectedFileIds.has(fileId)) {
          nextSelectedFileIds.add(fileId);
          didAddSelection = true;
        }
      }

      return didAddSelection
        ? { selectedFileIds: nextSelectedFileIds }
        : state;
    }),

  setSelectedFileIds: (fileIds) =>
    set({ selectedFileIds: createSelectedFileIdSet(fileIds) }),

  clearSelection: () =>
    set((state) =>
      state.selectedFileIds.size === 0
        ? state
        : { selectedFileIds: new Set() }
    ),

  clearSelectionForIds: (fileIds) =>
    set((state) => {
      if (state.selectedFileIds.size === 0) {
        return state;
      }

      let didRemoveSelection = false;
      const nextSelectedFileIds = new Set(state.selectedFileIds);

      for (const fileId of fileIds) {
        if (nextSelectedFileIds.delete(fileId)) {
          didRemoveSelection = true;
        }
      }

      return didRemoveSelection
        ? { selectedFileIds: nextSelectedFileIds }
        : state;
    }),

  setSettings: (settings) => set({ settings }),

  setAnalysisProgress: (progress) =>
    set((state) => ({
      analysisProgress: {
        ...state.analysisProgress,
        ...(typeof progress === 'function'
          ? progress(state.analysisProgress)
          : progress),
      },
    })),

  setFileOperationProgress: (progress) => set({ fileOperationProgress: progress }),

  setShowLogger: (show) => set({ showLogger: show }),

  clearFiles: () =>
    set({
      files: [],
      selectedFileIds: new Set(),
      currentDirectory: null,
      fileOperationProgress: null,
      analysisProgress: {
        totalBatches: 0,
        completedBatches: 0,
        failedBatches: 0,
        isRunning: false,
      },
    }),
}));
