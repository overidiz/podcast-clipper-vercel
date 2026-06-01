export interface Chapter {
  gist: string;
  headline: string;
  summary: string;
  start: number; // ms
  end: number; // ms
}

export interface TranscriptResult {
  id: string;
  status: "queued" | "processing" | "completed" | "error";
  text: string;
  chapters: Chapter[];
  audio_duration: number; // seconds
  error?: string;
}

const API_BASE = "https://api.assemblyai.com/v2";

function getApiKey(): string {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) throw new Error("ASSEMBLYAI_API_KEY nao configurada");
  return key;
}

export async function submitTranscription(
  audioUrl: string,
  language: string = "pt"
): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE}/transcript`, {
    method: "POST",
    headers: {
      authorization: getApiKey(),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      language_code: language === "auto" ? undefined : language,
      auto_chapters: true,
      punctuate: true,
      format_text: true,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AssemblyAI submit failed: ${err}`);
  }

  return res.json();
}

export async function getTranscript(
  transcriptId: string
): Promise<TranscriptResult> {
  const res = await fetch(`${API_BASE}/transcript/${transcriptId}`, {
    headers: { authorization: getApiKey() },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AssemblyAI get failed: ${err}`);
  }

  return res.json();
}

export async function pollTranscript(
  transcriptId: string,
  maxWaitMs: number = 600_000
): Promise<TranscriptResult> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const result = await getTranscript(transcriptId);
    if (result.status === "completed" || result.status === "error") {
      return result;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Transcricao excedeu o tempo limite");
}

export async function uploadAudio(
  audioBuffer: Buffer,
  filename: string = "audio.mp3"
): Promise<string> {
  const res = await fetch(`${API_BASE}/upload`, {
    method: "POST",
    headers: {
      authorization: getApiKey(),
      "content-type": "application/octet-stream",
    },
    body: new Uint8Array(audioBuffer),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`AssemblyAI upload failed: ${err}`);
  }

  const { upload_url } = await res.json();
  return upload_url;
}

export function chaptersToTopics(chapters: Chapter[]) {
  return chapters.map((ch, i) => ({
    index: i + 1,
    title: ch.headline || ch.gist || `Topico ${i + 1}`,
    summary: ch.summary || ch.gist,
    start: ch.start / 1000,
    end: ch.end / 1000,
    duration: (ch.end - ch.start) / 1000,
  }));
}
