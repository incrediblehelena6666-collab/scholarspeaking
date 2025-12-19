import React from 'react';

interface WaveformProps {
  isPlaying: boolean;
}

export const Waveform: React.FC<WaveformProps> = ({ isPlaying }) => {
  return (
    <div className="flex items-center justify-center gap-1 h-8">
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className={`w-1 bg-indigo-500 rounded-full transition-all duration-300 ${
            isPlaying ? 'animate-[pulse_1s_ease-in-out_infinite]' : 'h-1'
          }`}
          style={{
            height: isPlaying ? `${Math.random() * 20 + 8}px` : '4px',
            animationDelay: `${i * 0.1}s`
          }}
        />
      ))}
    </div>
  );
};