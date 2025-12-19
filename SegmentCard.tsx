import React, { useEffect, useRef } from 'react';
import { Segment } from '../types';

interface SegmentCardProps {
  segment: Segment;
  index: number;
  shouldPlay: boolean;
  onEnded: () => void;
  onPlay: () => void;
}

export const SegmentCard: React.FC<SegmentCardProps> = ({ 
  segment, 
  index, 
  shouldPlay, 
  onEnded,
  onPlay
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (shouldPlay && audioRef.current && segment.audioUrl) {
      audioRef.current.play().catch(e => console.log("Auto-play blocked:", e));
    }
  }, [shouldPlay, segment.audioUrl]);

  return (
    <div className={`border rounded-xl p-4 shadow-sm transition-all duration-500 ${
      shouldPlay ? 'bg-indigo-50 border-indigo-200 ring-1 ring-indigo-200' : 'bg-white border-slate-200'
    }`}>
      <div className="flex justify-between items-start mb-2">
        {/* Dynamic Title */}
        <div className="flex flex-col">
            <span className={`text-xs font-bold uppercase tracking-wider ${shouldPlay ? 'text-indigo-600' : 'text-slate-400'}`}>
              Segment {index + 1}
            </span>
            <span className="text-sm font-semibold text-slate-800">
               {segment.title || `Part ${index + 1}`}
            </span>
        </div>
        
        {/* Status Indicators */}
        {segment.status === 'processing' && (
          <span className="flex items-center gap-1 text-xs text-indigo-600 font-medium animate-pulse">
            <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
            Translating...
          </span>
        )}
        {segment.status === 'success' && !shouldPlay && (
          <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg>
            Ready
          </span>
        )}
        {shouldPlay && (
          <span className="text-xs text-indigo-600 font-bold flex items-center gap-1 animate-pulse">
            🔊 Playing
          </span>
        )}
        {segment.status === 'error' && (
          <span className="text-xs text-red-500 font-medium">Failed</span>
        )}
      </div>

      {/* Content */}
      <div className="space-y-3">
        {/* Error Message */}
        {segment.error && (
          <div className="p-2 bg-red-50 text-red-600 text-xs rounded border border-red-100">
            ⚠️ {segment.error}
          </div>
        )}

        {/* Translation */}
        {segment.translatedText ? (
          <p className="text-slate-800 text-base leading-relaxed font-serif">
            {segment.translatedText}
          </p>
        ) : (
          <p className="text-slate-400 text-sm italic">
            {segment.status === 'processing' ? 'Generating translation...' : 'Pending translation...'}
          </p>
        )}

        {/* Original Text (Subtle) */}
        <details className="group">
          <summary className="text-[10px] text-slate-400 cursor-pointer hover:text-indigo-500 list-none flex items-center gap-1 outline-none">
             <span className="group-open:rotate-90 transition-transform">▶</span> Show Original Text
          </summary>
          <p className="mt-1 text-xs text-slate-500 p-2 bg-slate-50 rounded border border-slate-100">
            {segment.originalText}
          </p>
        </details>

        {/* Audio Player */}
        {segment.audioUrl && (
          <div className="mt-2 pt-2 border-t border-slate-100/50">
            <audio 
              ref={audioRef}
              controls 
              src={segment.audioUrl} 
              className="w-full h-8 block"
              onEnded={onEnded}
              onPlay={onPlay}
            />
          </div>
        )}
      </div>
    </div>
  );
};