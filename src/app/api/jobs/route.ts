import { NextRequest, NextResponse } from "next/server";

const INVIDIOUS_INSTANCES = [
  "https://invidious.fdn.fr",
  "https://yewtu.be",
  "https://inv.nadeko.net",
  "https://invidious.privacyredirect.com",
];

interface GroqRequest {
  url: string;
  language?: string;
  apiKey?: string;
}

export async function POST(req: NextRequest) {
  try {
    const { url, language = "pt", apiKey }: GroqRequest = await req.json();
    if (!url) return NextResponse.json({ error: "URL obrigatoria" }, { status: 400 });

    const videoId = extractVideoId(url);
    if (!videoId) return NextResponse.json({ error: "URL invalida do YouTube" }, { status: 400 });

    // Get video info from Invidious
    const info = await getVideoInfo(videoId);
    if (!info) return NextResponse.json({ error: "Video nao encontrado" }, { status: 404 });

    // Get audio URL from Invidious
    const audioUrl = await getAudioUrl(videoId);
    if (!audioUrl) {
      return NextResponse.json({
        error: "Nao foi possivel obter o audio. Tente novamente.",
        fallback: true,
        videoId,
        title: info.title,
        duration: info.lengthSeconds,
      }, { status: 200 });
    }

    // Download audio
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) {
      return NextResponse.json({
        error: "Falha ao baixar audio",
        fallback: true,
        videoId,
        title: info.title,
      }, { status: 200 });
    }

    const audioBuffer = await audioRes.arrayBuffer();

    // Check file size (max 25MB for Groq)
    if (audioBuffer.byteLength > 25 * 1024 * 1024) {
      return NextResponse.json({
        error: "Audio muito grande (max 25MB). Tente um video mais curto.",
        fallback: true,
        videoId,
        title: info.title,
      }, { status: 200 });
    }

    // If Groq API key provided, use it
    if (apiKey) {
      try {
        const { transcribeWithGroq, analyzeWithGroq } = await import("@/lib/groq-client");

        const transcript = await transcribeWithGroq(audioBuffer, apiKey, language);
        const analysis = await analyzeWithGroq(transcript.text, transcript.segments, apiKey, language);

        return NextResponse.json({
          videoId,
          title: info.title,
          duration: info.lengthSeconds,
          transcript: transcript.text,
          segments: transcript.segments,
          ...analysis,
          provider: "groq",
        });
      } catch (groqErr) {
        console.error("Groq error:", groqErr);
        // Fall through to local mode
      }
    }

    // Local mode: return video info for client-side processing
    return NextResponse.json({
      fallback: true,
      videoId,
      title: info.title,
      duration: info.lengthSeconds,
      message: "Audio recebido. Processando localmente...",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro interno" },
      { status: 500 }
    );
  }
}

function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:v=|\/v\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:shorts\/)([a-zA-Z0-9_-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

async function getVideoInfo(videoId: string) {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetch(`${base}/api/v1/videos/${videoId}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) return res.json();
    } catch {
      continue;
    }
  }
  // Fallback: use noembed
  try {
    const res = await fetch(
      `https://noembed.com/embed?url=https://youtube.com/watch?v=${videoId}`
    );
    if (res.ok) {
      const data = await res.json();
      return { title: data.title || "Video", lengthSeconds: 0 };
    }
  } catch {}
  return null;
}

async function getAudioUrl(videoId: string): Promise<string | null> {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetch(`${base}/api/v1/videos/${videoId}`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const data = await res.json();

      const formats = data.adaptiveFormats || data.formatStreams || [];
      // Prefer opus > m4a > any audio
      const audio = formats.find((f: Record<string, unknown>) =>
        f.type?.toString().includes("audio") && f.type?.toString().includes("opus")
      ) || formats.find((f: Record<string, unknown>) =>
        f.type?.toString().includes("audio")
      ) || formats.find((f: Record<string, unknown>) =>
        f.url && !f.type?.toString().includes("video")
      );

      if (audio?.url) return audio.url as string;
    } catch {
      continue;
    }
  }
  return null;
}
