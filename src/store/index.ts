import { create } from 'zustand';
import type { FileItem, AppSettings, AnalysisProgress } from '../shared/types';

interface AppStore {
  currentDirectory: string | null;
  files: FileItem[];
  settings: AppSettings | null;
  analysisProgress: AnalysisProgress;
  
  setCurrentDirectory: (directory: string | null) => void;
  setFiles: (files: FileItem[]) => void;
  updateFile: (id: string, updates: Partial<FileItem>) => void;
  removeFiles: (ids: string[]) => void;
  toggleFileSelection: (id: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  setSettings: (settings: AppSettings) => void;
  setAnalysisProgress: (progress: Partial<AnalysisProgress>) => void;
  clearFiles: () => void;
}

export const useAppStore = create<AppStore>((set) => ({
  currentDirectory: null,
  files: [],
  settings: null,
  analysisProgress: {
    totalBatches: 0,
    completedBatches: 0,
    failedBatches: 0,
    isRunning: false,
  },

  setCurrentDirectory: (directory) => set({ currentDirectory: directory }),
  
  setFiles: (files) => set({ files }),
  
  updateFile: (id, updates) =>
    set((state) => ({
      files: state.files.map((file) =>
        file.id === id ? { ...file, ...updates } : file
      ),
    })),
  
  removeFiles: (ids) =>
    set((state) => ({
      files: state.files.filter((file) => !ids.includes(file.id)),
    })),
  
  toggleFileSelection: (id) =>
    set((state) => ({
      files: state.files.map((file) =>
        file.id === id ? { ...file, selected: !file.selected } : file
      ),
    })),
  
  selectAll: () =>
    set((state) => ({
      files: state.files.map((file) => ({ ...file, selected: true })),
    })),
  
  deselectAll: () =>
    set((state) => ({
      files: state.files.map((file) => ({ ...file, selected: false })),
    })),
  
  setSettings: (settings) => set({ settings }),
  
  setAnalysisProgress: (progress) =>
    set((state) => ({
      analysisProgress: { ...state.analysisProgress, ...progress },
    })),
  
  clearFiles: () =>
    set({
      files: [],
      currentDirectory: null,
      analysisProgress: {
        totalBatches: 0,
        completedBatches: 0,
        failedBatches: 0,
        isRunning: false,
      },
    }),
}));
