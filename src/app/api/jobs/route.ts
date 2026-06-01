import { NextRequest, NextResponse } from "next/server";

const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const INNERTUBE_API = "https://www.youtube.com/youtubei/v1/player";

interface Format {
  itag: number;
  url: string;
  mimeType: string;
  bitrate: number;
  contentLength?: string;
}

interface VideoData {
  videoId: string;
  title: string;
  duration: number;
  thumbnails: { url: string; width: number; height: number }[];
  formats: Format[];
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

async function getVideoData(videoId: string): Promise<VideoData | null> {
  try {
    const res = await fetch(`${INNERTUBE_API}?key=${INNERTUBE_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: "WEB",
            clientVersion: "2.20250601.00.00",
            hl: "pt",
            gl: "BR",
            utcOffsetMinutes: -180,
          },
        },
      }),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (!data.streamingData) return null;

    const details = data.videoDetails || {};
    const thumbnails = details.thumbnail?.thumbnails || [];

    // Collect all adaptive formats
    const adaptiveFormats: Format[] = (data.streamingData.adaptiveFormats || [])
      .map((f: Record<string, unknown>) => ({
        itag: f.itag as number,
        url: f.url as string,
        mimeType: (f.mimeType as string) || "",
        bitrate: (f.bitrate as number) || 0,
        contentLength: f.contentLength as string | undefined,
      }));

    return {
      videoId,
      title: details.title || "Video",
      duration: parseInt(details.lengthSeconds || "0", 10),
      thumbnails,
      formats: adaptiveFormats,
    };
  } catch {
    return null;
  }
}

function pickAudioFormat(formats: Format[]): Format | null {
  // Prefer opus > m4a > any audio
  const opus = formats.find(
    (f) => f.mimeType.includes("audio") && f.mimeType.includes("opus")
  );
  if (opus) return opus;

  const m4a = formats.find(
    (f) => f.mimeType.includes("audio") && f.mimeType.includes("mp4")
  );
  if (m4a) return m4a;

  return formats.find((f) => f.mimeType.includes("audio")) || null;
}

function pickVideoFormat(formats: Format[]): Format | null {
  // Prefer 1080p mp4 or lower for compatibility
  const mp4_1080 = formats.find(
    (f) => f.mimeType.includes("video/mp4") && f.itag === 137
  );
  if (mp4_1080) return mp4_1080;

  const mp4_720 = formats.find(
    (f) => f.mimeType.includes("video/mp4") && f.itag === 136
  );
  if (mp4_720) return mp4_720;

  const mp4_360 = formats.find(
    (f) => f.mimeType.includes("video/mp4") && f.itag === 135
  );
  if (mp4_360) return mp4_360;

  return formats.find((f) => f.mimeType.includes("video/mp4")) || null;
}

export async function POST(req: NextRequest) {
  try {
    const { url, language = "pt", apiKey } = await req.json();
    if (!url) return NextResponse.json({ error: "URL obrigatoria" }, { status: 400 });

    const videoId = extractVideoId(url);
    if (!videoId) return NextResponse.json({ error: "URL invalida do YouTube" }, { status: 400 });

    // Get video metadata + stream URLs via YouTube InnerTube API
    const videoData = await getVideoData(videoId);
    if (!videoData) {
      return NextResponse.json({
        error: "Video nao encontrado ou indisponivel. Tente outro link.",
      }, { status: 404 });
    }

    const audioFormat = pickAudioFormat(videoData.formats);
    const videoFormat = pickVideoFormat(videoData.formats);

    if (!audioFormat) {
      return NextResponse.json({
        error: "Nao foi possivel extrair audio do video. O video pode estar bloqueado.",
      }, { status: 400 });
    }

    // Download audio for transcription
    let audioBuffer: ArrayBuffer | null = null;
    try {
      const audioRes = await fetch(audioFormat.url, {
        signal: AbortSignal.timeout(60000),
      });
      if (audioRes.ok) {
        audioBuffer = await audioRes.arrayBuffer();
      }
    } catch {
      // Will continue without audio
    }

    // Prepare response with video metadata
    const response: Record<string, unknown> = {
      videoId,
      title: videoData.title,
      duration: videoData.duration,
      thumbnail: videoData.thumbnails?.[videoData.thumbnails.length - 1]?.url || "",
      videoUrl: videoFormat?.url || null,
      audioUrl: audioFormat.url,
    };

    // If Groq API key provided and we have audio, transcribe + analyze
    if (apiKey && audioBuffer) {
      try {
        const { transcribeWithGroq, analyzeWithGroq } = await import("@/lib/groq-client");

        const transcript = await transcribeWithGroq(audioBuffer, apiKey, language);
        const analysis = await analyzeWithGroq(transcript.text, transcript.segments, apiKey, language);

        return NextResponse.json({
          ...response,
          transcript: transcript.text,
          segments: transcript.segments,
          ...analysis,
          provider: "groq",
        });
      } catch (groqErr) {
        console.error("Groq error:", groqErr);
      }
    }

    // Return video info for client-side processing
    return NextResponse.json({
      ...response,
      note: audioBuffer
        ? "Audio extraido com sucesso. Use a chave Groq para transcricao com IA."
        : "Audio nao pode ser baixado do servidor. Tente com a chave Groq.",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro interno" },
      { status: 500 }
    );
  }
}
