import { GoogleGenAI, Modality } from "@google/genai";
import { ReadingMode } from "../types";
import { concatAudioData, decodeBase64 } from "../utils/audioUtils";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- PROMPTS ---

const EXTRACT_PROMPT = `
Task: Extract the raw text content from the provided document.
Rules:
1. Return ONLY the text content.
2. Do not summarize.
3. Do not add markdown formatting.
4. Ignore page numbers or headers if possible.
`;

const TRANSLATE_CHUNK_PROMPT = `
You are an expert academic translator.
Task: Translate the following academic text segment into spoken Chinese.

CRITICAL CITATION RULES:
1. Detect patterns like "(Deci, 2020)" or "Ryan (2000)".
2. Convert to spoken Chinese:
   - "(Deci, 2020)" -> "Deci在2020年提到"
   - "(Ryan & Deci, 2000)" -> "Ryan和Deci在2000年的研究中指出"
3. DO NOT read parentheses literally.
4. Keep the tone professional but flow naturally.

Output: Return ONLY the translated Chinese text.
`;

const PODCAST_PROMPT = `
You are "ScholarBot", a charismatic academic podcast host.
Task: Explain the academic document in Chinese using a "Podcast" style.

Rules:
1. **Intro/Outro**: Start with a hook and end with a summary.
2. **Content**: Summarize Core Contribution, Methodology, and Key Findings. Do not translate word-for-word.
3. **Style**: Conversational, engaging, use analogies.
4. **Citations**: Mention key authors naturally ("The famous researcher Deci argues that...").
5. Output ONLY the Chinese script.
`;

export interface ScriptInput {
  type: 'text' | 'file';
  content: string; // text string or base64 data
  mimeType?: string; // required if type is file
}

export interface TextChunk {
  title: string;
  text: string;
}

// --- NEW: Helper to extract raw text first ---
export const extractRawText = async (input: ScriptInput, onLog: (msg: string) => void): Promise<string> => {
  try {
    onLog("📄 Extracting raw text from document...");
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [{ 
          inlineData: { mimeType: input.mimeType!, data: input.content } 
        }]
      },
      config: { systemInstruction: EXTRACT_PROMPT }
    });

    const text = response.text;
    if (!text) throw new Error("No text extracted");
    onLog(`✅ Text extracted (${text.length} chars).`);
    return text;
  } catch (e: any) {
    onLog(`❌ Extraction failed: ${e.message}`);
    throw e;
  }
};

// --- NEW: Translate a specific chunk ---
export const translateChunk = async (text: string, onLog: (msg: string) => void): Promise<string> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: text,
      config: { systemInstruction: TRANSLATE_CHUNK_PROMPT }
    });
    return response.text || "";
  } catch (e: any) {
    onLog(`❌ Translation failed: ${e.message}`);
    throw e;
  }
};

// --- EXISTING: Podcast Script Generation ---
export const generatePodcastScript = async (input: ScriptInput, onLog: (msg: string) => void): Promise<string> => {
  try {
    onLog(`🎙️ Generating Podcast Script...`);
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [{ inlineData: { mimeType: input.mimeType!, data: input.content } }]
      },
      config: { systemInstruction: PODCAST_PROMPT }
    });
    return response.text || "";
  } catch (error: any) {
    throw error;
  }
};

// --- TTS GENERATION ---
export const generateSpeech = async (text: string, onLog: (msg: string) => void): Promise<Uint8Array> => {
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ parts: [{ text: text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) throw new Error("No audio returned");
    
    return decodeBase64(base64Audio);
  } catch (error: any) {
    onLog(`❌ TTS Error: ${error.message}`);
    throw error;
  }
};

// --- NEW: Semantic & Greedy Splitting Logic ---

// Common academic headers regex
const HEADER_REGEX = /(?:^|\n)(abstract|introduction|background|literature review|methods|methodology|results|discussion|conclusion|references|appendix)/i;

/**
 * Splits text into logical chunks:
 * 1. Tries to split by academic sections (Headers).
 * 2. Within sections, greedily aggregates paragraphs up to targetChars.
 */
export function semanticSplit(text: string, targetChars: number = 3500): TextChunk[] {
  const finalChunks: TextChunk[] = [];
  
  // Step 1: Split into high-level sections based on headers
  // We use a simple approach: split by double newline, then check if the start matches a header
  // Note: Regex split might be complex to keep headers, so we'll do a robust paragraph scan.
  
  const sections: { title: string, content: string }[] = [];
  
  // Normalize newlines
  const cleanText = text.replace(/\r\n/g, '\n');
  const rawParagraphs = cleanText.split('\n\n');
  
  let currentSectionTitle = "Start of Paper";
  let currentSectionBuffer: string[] = [];

  for (const para of rawParagraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // Check if this paragraph is a header
    // Logic: Short (<100 chars) and matches header keywords
    const isHeader = trimmed.length < 100 && HEADER_REGEX.test(trimmed);

    if (isHeader) {
      // Flush previous section
      if (currentSectionBuffer.length > 0) {
        sections.push({ 
          title: currentSectionTitle, 
          content: currentSectionBuffer.join('\n\n') 
        });
      }
      // Start new section
      currentSectionTitle = trimmed.replace(/[.:]+$/, ''); // Remove trailing dots/colons
      currentSectionBuffer = []; // We don't add the header itself to the content to avoid reading it twice redundantly, or we can add it. Let's add it to content for context.
      currentSectionBuffer.push(trimmed);
    } else {
      currentSectionBuffer.push(trimmed);
    }
  }
  
  // Flush last section
  if (currentSectionBuffer.length > 0) {
    sections.push({ 
      title: currentSectionTitle, 
      content: currentSectionBuffer.join('\n\n') 
    });
  }

  // Step 2: Greedy Aggregation within Sections
  for (const section of sections) {
    // If section is small enough, keep as one
    if (section.content.length <= targetChars) {
      finalChunks.push({
        title: section.title,
        text: section.content
      });
      continue;
    }

    // If section is large, split strictly by paragraphs
    const paras = section.content.split('\n'); // Split by single newline to be granular
    let buffer = "";
    let partCount = 1;

    for (const p of paras) {
      if ((buffer.length + p.length) > targetChars && buffer.length > 0) {
        // Push current buffer
        finalChunks.push({
          title: `${section.title} (Part ${partCount})`,
          text: buffer.trim()
        });
        buffer = p;
        partCount++;
      } else {
        buffer += "\n" + p;
      }
    }

    // Flush remaining buffer
    if (buffer.trim()) {
      finalChunks.push({
        title: partCount > 1 ? `${section.title} (Part ${partCount})` : section.title,
        text: buffer.trim()
      });
    }
  }

  // Fallback: If logic failed and produced 0 chunks (empty text), return nothing
  return finalChunks;
}