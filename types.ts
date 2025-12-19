export enum ReadingMode {
  LITERAL = 'LITERAL',
  PODCAST = 'PODCAST'
}

export interface AudioState {
  isPlaying: boolean;
  isGenerating: boolean;
  currentTime: number;
  duration: number;
}

export type SegmentStatus = 'pending' | 'processing' | 'success' | 'error';

export interface Segment {
  id: string;
  title?: string; // e.g., "Abstract" or "Introduction (Part 1)"
  originalText: string;
  translatedText?: string;
  audioUrl?: string;
  status: SegmentStatus;
  error?: string;
}