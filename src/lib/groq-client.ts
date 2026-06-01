// Groq API client - free tier (generous rate limits)
// https://console.groq.com - get your free API key

const GROQ_BASE = "https://api.groq.com/openai/v1";

interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

interface TranscriptResult {
  text: string;
  segments: { start: number; end: number; text: string }[];
  language: string;
}

export async function transcribeWithGroq(
  audioBuffer: ArrayBuffer,
  apiKey: string,
  language: string = "pt"
): Promise<TranscriptResult> {
  // Groq accepts up to 25MB
  const formData = new FormData();
  formData.append("file", new Blob([audioBuffer], { type: "audio/mpeg" }), "audio.mp3");
  formData.append("model", "whisper-large-v3-turbo");
  formData.append("response_format", "verbose_json");
  formData.append("timestamp_granularities", "segment");
  if (language !== "auto") {
    formData.append("language", language);
  }

  const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq transcription failed: ${err}`);
  }

  const data = await res.json();
  return {
    text: data.text,
    segments: (data.segments || []).map((s: Record<string, unknown>) => ({
      start: s.start as number,
      end: s.end as number,
      text: s.text as string,
    })),
    language: data.language || language,
  };
}

interface Topic {
  index: number;
  title: string;
  summary: string;
  start: number;
  end: number;
  duration: number;
}

interface ClipMetadata {
  topics: Topic[];
  seoDescription: string;
  hashtags: string[];
  tags: string[];
  suggestedTitles: string[];
}

export async function analyzeWithGroq(
  transcript: string,
  segments: { start: number; end: number; text: string }[],
  apiKey: string,
  language: string = "pt"
): Promise<ClipMetadata> {
  const segmentsText = segments
    .map((s) => `[${fmt(s.start)}->${fmt(s.end)}] ${s.text}`)
    .join("\n");

  const prompt =
    language === "pt"
      ? `Analise esta transcricao de podcast e retorne APENAS JSON valido (sem markdown):

{
  "topics": [
    {
      "title": "titulo curto e chamativo (max 60 chars)",
      "summary": "resumo de 1-2 frases do que foi dito",
      "start": <tempo em segundos>,
      "end": <tempo em segundos>
    }
  ],
  "seoDescription": "descricao SEO otimizada para YouTube (2-3 frases, inclua palavras-chave)",
  "hashtags": ["#hashtag1", "#hashtag2", ...] (10-15 hashtags relevantes),
  "tags": ["tag1", "tag2", ...] (8-12 tags para YouTube, sem #),
  "suggestedTitles": ["titulo 1", "titulo 2", "titulo 3"] (3 titulos otimizados para YouTube)
}

Regras:
- Detecte entre 3 e 8 topicos naturais (nao force topicos artificiais)
- Cada topico deve ter no minimo 45 segundos
- Titulos devem ser intrigantes, estilo YouTube (use numeros, perguntas, curiosidades)
- Hashtags devem ser especificas e relevantes ao conteudo
- A descricao SEO deve ser persuasiva e incluir CTA

Transcricao com timestamps:
${segmentsText}`
      : `Analyze this podcast transcript and return ONLY valid JSON (no markdown):

{
  "topics": [...same structure...],
  "seoDescription": "...",
  "hashtags": [...],
  "tags": [...],
  "suggestedTitles": [...]
}

Rules:
- Detect 3-8 natural topics (don't force artificial ones)
- Each topic min 45 seconds
- Titles should be intriguing, YouTube-style (use numbers, questions, hooks)
- Hashtags specific and relevant
- SEO description persuasive with CTA

Transcript with timestamps:
${segmentsText}`;

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: "You are a professional YouTube content strategist. Return only valid JSON, no markdown, no backticks." },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 4000,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq analysis failed: ${err}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "{}";

  // Clean markdown code blocks if present
  const jsonStr = content
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  try {
    const parsed = JSON.parse(jsonStr);
    return {
      topics: (parsed.topics || []).map((t: Record<string, unknown>, i: number) => ({
        index: i + 1,
        title: String(t.title || `Topico ${i + 1}`).slice(0, 60),
        summary: String(t.summary || "").slice(0, 200),
        start: Number(t.start) || 0,
        end: Number(t.end) || 0,
        duration: (Number(t.end) || 0) - (Number(t.start) || 0),
      })),
      seoDescription: String(parsed.seoDescription || ""),
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [],
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      suggestedTitles: Array.isArray(parsed.suggestedTitles) ? parsed.suggestedTitles : [],
    };
  } catch {
    throw new Error(`Failed to parse Groq response: ${jsonStr.slice(0, 200)}`);
  }
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
