import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  extractRawText, 
  translateChunk, 
  generateSpeech, 
  generatePodcastScript, 
  semanticSplit, 
  ScriptInput 
} from './services/geminiService';
import { createWavBlob } from './utils/audioUtils';
import { fileToBase64, formatFileSize } from './utils/fileUtils';
import { ReadingMode, Segment } from './types';
import { Button } from './components/Button';
import { SegmentCard } from './components/SegmentCard';

const App: React.FC = () => {
  // File state
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  
  // Modes
  const [mode, setMode] = useState<ReadingMode>(ReadingMode.LITERAL);
  
  // Podcast State
  const [podcastScript, setPodcastScript] = useState<string>('');
  const [podcastAudio, setPodcastAudio] = useState<string | null>(null);
  
  // Literal (Streaming) State
  const [segments, setSegments] = useState<Segment[]>([]);
  const [currentPlayingIndex, setCurrentPlayingIndex] = useState<number>(-1);
  
  // General State
  const [logs, setLogs] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{current: number, total: number} | null>(null);

  // Log helper
  const addLog = useCallback((msg: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    setTimeout(() => {
      const el = document.getElementById('log-end');
      el?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }, []);

  // --- LOGIC: Literal Streaming Mode ---
  const processLiteralMode = async (fileInput: ScriptInput) => {
    setSegments([]); // Clear previous
    setCurrentPlayingIndex(-1);
    setIsProcessing(true);
    
    try {
      // 1. Extract Raw Text
      addLog("🔍 Step 1: Extracting raw text from file...");
      let rawText = await extractRawText(fileInput, addLog);
      
      // Increased safety limit to 50k chars (approx 20 pages) to allow full paper testing
      const LIMIT = 50000;
      if (rawText.length > LIMIT) {
        addLog(`⚠️ System: Text length ${rawText.length} exceeds safety limit. Truncating to ${LIMIT} chars.`);
        rawText = rawText.substring(0, LIMIT);
      }

      // 2. Semantic Split (Target ~3500 chars for long audio)
      addLog("✂️ Step 2: Analyzing structure and splitting into long audio segments...");
      const textChunks = semanticSplit(rawText, 3500); 
      addLog(`ℹ️ Created ${textChunks.length} logical segments (Abstract, Intro, etc.).`);

      // 3. Initialize UI segments
      const initialSegments: Segment[] = textChunks.map((chunk, idx) => ({
        id: `seg-${idx}`,
        title: chunk.title,
        originalText: chunk.text,
        status: 'pending'
      }));
      setSegments(initialSegments);

      // Start processing loop
      for (let i = 0; i < initialSegments.length; i++) {
        const segId = initialSegments[i].id;
        const currentTitle = initialSegments[i].title || `Segment ${i+1}`;
        
        setSegments(prev => prev.map(s => s.id === segId ? { ...s, status: 'processing' } : s));
        setProgress({ current: i + 1, total: initialSegments.length });
        
        try {
          // A. Translate
          // addLog(`Processing "${currentTitle}": Translating...`);
          const translated = await translateChunk(initialSegments[i].originalText, addLog);
          setSegments(prev => prev.map(s => s.id === segId ? { ...s, translatedText: translated } : s));

          // B. TTS
          // addLog(`Processing "${currentTitle}": Generating Audio...`);
          const pcmData = await generateSpeech(translated, addLog);
          
          // Helper to convert float32 to wav
          const int16Array = new Int16Array(pcmData.buffer);
          const float32Array = new Float32Array(int16Array.length);
          for(let j=0; j<int16Array.length; j++) {
            float32Array[j] = int16Array[j] / 32768.0;
          }
          
          const blob = createWavBlob(float32Array, 24000);
          const audioUrl = URL.createObjectURL(blob);

          setSegments(prev => prev.map(s => s.id === segId ? { 
            ...s, 
            status: 'success', 
            audioUrl: audioUrl 
          } : s));
          
          // Auto-play the first segment if nothing is playing
          if (i === 0) {
            setCurrentPlayingIndex(0);
          }

          addLog(`✅ "${currentTitle}" Ready.`);

        } catch (err: any) {
          addLog(`❌ "${currentTitle}" Failed: ${err.message}`);
          setSegments(prev => prev.map(s => s.id === segId ? { 
            ...s, 
            status: 'error', 
            error: err.message 
          } : s));
        }
      }
      addLog("🎉 All segments processed.");

    } catch (e: any) {
      addLog(`🔥 Critical Error: ${e.message}`);
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  };

  // --- LOGIC: Podcast Mode ---
  const processPodcastMode = async (fileInput: ScriptInput) => {
    setIsProcessing(true);
    setPodcastScript('');
    setPodcastAudio(null);
    
    try {
      addLog("🎙️ Generating Podcast Script...");
      const script = await generatePodcastScript(fileInput, addLog);
      setPodcastScript(script);
      
      addLog("🔊 Synthesizing Podcast Audio (this may take a moment)...");
      const pcmData = await generateSpeech(script, addLog);
      
      const int16Array = new Int16Array(pcmData.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for(let j=0; j<int16Array.length; j++) {
        float32Array[j] = int16Array[j] / 32768.0;
      }
      const blob = createWavBlob(float32Array, 24000);
      setPodcastAudio(URL.createObjectURL(blob));
      
      addLog("✅ Podcast Ready!");

    } catch (e: any) {
      addLog(`❌ Podcast Error: ${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleProcess = async (selectedMode: ReadingMode) => {
    if (!selectedFile) return;
    setMode(selectedMode);
    
    const base64 = await fileToBase64(selectedFile);
    const input: ScriptInput = {
      type: 'file',
      content: base64,
      mimeType: selectedFile.type || 'application/pdf'
    };

    if (selectedMode === ReadingMode.LITERAL) {
      await processLiteralMode(input);
    } else {
      await processPodcastMode(input);
    }
  };

  // --- HANDLERS ---
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") setDragActive(true);
    else if (e.type === "dragleave") setDragActive(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) handleFile(e.target.files[0]);
  };

  const handleFile = (file: File) => {
    setSelectedFile(file);
    setSegments([]);
    setCurrentPlayingIndex(-1);
    setPodcastScript('');
    setPodcastAudio(null);
    setLogs([]);
    addLog(`File selected: ${file.name} (${formatFileSize(file.size)})`);
  };

  const handleSegmentEnded = (index: number) => {
    // Auto-advance to next if available
    if (index + 1 < segments.length) {
      // Check if next segment is ready
      if (segments[index + 1].status === 'success') {
        setCurrentPlayingIndex(index + 1);
      } else {
        // If not ready, we could wait, but for now let's just stop or user clicks manually when ready
        // Ideally we would set a 'waiting' state, but simplistic approach:
        setCurrentPlayingIndex(index + 1); // Component will auto-play when URL becomes available
      }
    } else {
      setCurrentPlayingIndex(-1); // End of queue
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-8 h-8 text-indigo-600" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">ScholarVoice</h1>
          </div>
          <div className="text-sm text-slate-500 hidden sm:block">
            PhD Research Assistant
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 gap-8 grid grid-cols-1 lg:grid-cols-2 items-start">
        
        {/* Left Column: Input & Controls */}
        <div className="flex flex-col h-auto lg:h-[calc(100vh-8rem)] gap-4">
          
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col flex-1 relative overflow-hidden">
            {/* 1. Header */}
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center flex-none">
              <h2 className="font-semibold text-slate-700">1. Upload Literature</h2>
              {selectedFile && (
                <button onClick={() => handleFile(new File([], ""))} className="text-xs text-red-500 hover:text-red-700 font-medium">Remove</button>
              )}
            </div>
            
            {/* 2. Body (Drop Zone) */}
            <div className="flex-grow p-6 flex flex-col relative overflow-y-auto min-h-[250px]">
              
              {/* Progress Overlay */}
              {isProcessing && progress && (
                <div className="absolute inset-0 bg-white/95 z-30 flex flex-col items-center justify-center p-8 backdrop-blur-sm">
                   <div className="w-full max-w-xs bg-slate-200 rounded-full h-4 mb-4 overflow-hidden">
                      <div 
                        className="bg-indigo-600 h-4 rounded-full transition-all duration-300 ease-out"
                        style={{ width: `${(progress.current / progress.total) * 100}%` }}
                      ></div>
                   </div>
                   <p className="text-indigo-900 font-bold text-lg animate-pulse">
                     Processing Part {progress.current} of {progress.total}
                   </p>
                   <p className="text-slate-500 text-sm mt-2">Analyzing structure, Translating & Generating Audio...</p>
                </div>
              )}

              {!selectedFile ? (
                <div 
                  className={`flex-grow border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-center p-8 transition-colors cursor-pointer min-h-[200px] ${
                    dragActive ? "border-indigo-500 bg-indigo-50" : "border-slate-300 hover:border-indigo-400 hover:bg-slate-50"
                  }`}
                  onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
                >
                  <input type="file" className="hidden" id="file-upload" onChange={handleChange} accept=".pdf,.txt,.md" />
                  <label htmlFor="file-upload" className="flex flex-col items-center cursor-pointer w-full h-full justify-center">
                    <div className="w-16 h-16 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center mb-4">
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
                    </div>
                    <p className="text-slate-700 font-medium text-lg mb-1">Drag & Drop PDF</p>
                    <p className="text-slate-400 text-sm">PDF, TXT, MD supported</p>
                  </label>
                </div>
              ) : (
                <div className="flex-grow flex flex-col items-center justify-center bg-slate-50 rounded-xl border border-slate-200 p-8 min-h-[200px]">
                  <div className="w-20 h-20 bg-white shadow-sm rounded-2xl flex items-center justify-center mb-4 text-red-500 border border-slate-100">
                    <svg className="w-10 h-10" fill="currentColor" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z"/></svg>
                  </div>
                  <h3 className="text-lg font-semibold text-slate-800 text-center break-all max-w-xs">{selectedFile.name}</h3>
                  <p className="text-slate-500 text-sm mt-1">{formatFileSize(selectedFile.size)}</p>
                </div>
              )}
            </div>

            {/* 3. Footer (Buttons) */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex flex-wrap gap-3 flex-none z-10">
              <Button 
                onClick={() => handleProcess(ReadingMode.LITERAL)}
                isLoading={isProcessing && mode === ReadingMode.LITERAL}
                disabled={isProcessing || !selectedFile}
                className="flex-1"
              >
                Literal Reading (Formal)
              </Button>
              <Button 
                variant="secondary"
                onClick={() => handleProcess(ReadingMode.PODCAST)}
                isLoading={isProcessing && mode === ReadingMode.PODCAST}
                disabled={isProcessing || !selectedFile}
                className="flex-1"
              >
                Podcast Mode (Fun)
              </Button>
            </div>
          </div>

          {/* Debug Console */}
          <div className="h-48 bg-slate-900 rounded-2xl p-4 overflow-hidden flex flex-col shadow-inner flex-none">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">System Logs</h3>
              <span className="text-[10px] text-slate-600">Real-time</span>
            </div>
            <div className="flex-grow overflow-y-auto font-mono text-xs text-green-400 space-y-1 scrollbar-thin scrollbar-thumb-slate-700">
              {logs.length === 0 && <span className="text-slate-600 italic">Waiting for input...</span>}
              {logs.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
              <div id="log-end" />
            </div>
          </div>
        </div>

        {/* Right Column: Output */}
        <div className="flex flex-col h-auto lg:h-[calc(100vh-8rem)] bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative">
          
          <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center flex-none">
             <div className="flex items-center gap-2">
                <h2 className="font-semibold text-slate-700">
                  {mode === ReadingMode.LITERAL ? 'Segmented Audio Flow' : 'Podcast Summary'}
                </h2>
                {mode === ReadingMode.LITERAL && <span className="text-xs bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full">Streaming</span>}
                {mode === ReadingMode.PODCAST && <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">Single Track</span>}
             </div>
          </div>
          
          <div className="flex-grow overflow-y-auto bg-slate-50/50 p-4">
            {/* Mode A: Podcast */}
            {mode === ReadingMode.PODCAST && (
              <div className="space-y-4">
                 {podcastAudio && (
                   <div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                      <audio controls src={podcastAudio} className="w-full" autoPlay />
                   </div>
                 )}
                 {podcastScript ? (
                   <div className="prose prose-slate max-w-none text-base font-serif bg-white p-6 rounded-xl shadow-sm border border-slate-100">
                     {podcastScript}
                   </div>
                 ) : (
                   !isProcessing && <div className="text-center text-slate-400 mt-20">Podcast script will appear here.</div>
                 )}
              </div>
            )}

            {/* Mode B: Literal (Segment List) */}
            {mode === ReadingMode.LITERAL && (
              <div className="space-y-4">
                {segments.map((seg, idx) => (
                  <SegmentCard 
                    key={seg.id} 
                    segment={seg} 
                    index={idx}
                    shouldPlay={idx === currentPlayingIndex}
                    onPlay={() => setCurrentPlayingIndex(idx)}
                    onEnded={() => handleSegmentEnded(idx)}
                  />
                ))}
                {segments.length === 0 && !isProcessing && (
                   <div className="text-center text-slate-400 mt-20">
                      Upload a file and click "Literal Reading" to start streaming.
                   </div>
                )}
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  );
};

export default App;