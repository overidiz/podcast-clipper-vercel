import { NextRequest, NextResponse } from "next/server";

function extractVideoId(url: string): string | null {
  const p = /(?:v=|\/v\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const m = url.match(p);
  return m ? m[1] : url.length === 11 ? url : null;
}

interface VideoInfo {
  videoId: string;
  title: string;
  duration: number;
  thumbnail: string;
  audioUrl: string | null;
  videoUrl: string | null;
}

async function getVideoInfo(videoId: string): Promise<VideoInfo | null> {
  try {
    // Fetch YouTube watch page and extract ytInitialPlayerResponse
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!pageRes.ok) return null;
    const html = await pageRes.text();

    // Extract ytInitialPlayerResponse JSON
    const jsonMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});\s*var/);
    if (!jsonMatch) return null;

    const playerResponse = JSON.parse(jsonMatch[1]);
    const details = playerResponse.videoDetails;
    if (!details) return null;

    const formats: Record<string, unknown>[] =
      playerResponse.streamingData?.adaptiveFormats || [];

    // Best audio (opus webm)
    const audio = formats.find((f: Record<string, unknown>) =>
      (f.mimeType as string)?.includes("audio") &&
      !f.qualityLabel
    );

    // Best video (720p mp4, no audio)
    const video = formats.find((f: Record<string, unknown>) =>
      (f.mimeType as string)?.includes("video/mp4") &&
      (f.qualityLabel as string) === "720p"
    ) || formats.find((f: Record<string, unknown>) =>
      (f.mimeType as string)?.includes("video/mp4")
    );

    const thumbs = details.thumbnail?.thumbnails || [];

    return {
      videoId,
      title: (details.title as string) || "Video",
      duration: parseInt((details.lengthSeconds as string) || "0", 10),
      thumbnail: thumbs[thumbs.length - 1]?.url || thumbs[0]?.url || "",
      audioUrl: (audio?.url as string) || null,
      videoUrl: (video?.url as string) || null,
    };
  } catch (err) {
    console.error("getVideoInfo error:", err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { url, language = "pt", apiKey } = await req.json();
    if (!url) return NextResponse.json({ error: "URL obrigatoria" }, { status: 400 });

    const videoId = extractVideoId(url);
    if (!videoId) return NextResponse.json({ error: "URL invalida" }, { status: 400 });

    const info = await getVideoInfo(videoId);
    if (!info) {
      return NextResponse.json({
        error: "Nao foi possivel acessar o video. Verifique se o link esta correto e se o video e publico.",
      }, { status: 404 });
    }

    // If Groq key provided, try to download and transcribe audio
    if (apiKey && info.audioUrl) {
      try {
        const audioRes = await fetch(info.audioUrl, {
          signal: AbortSignal.timeout(120000),
        });
        if (audioRes.ok) {
          const audioBuffer = await audioRes.arrayBuffer();
          if (audioBuffer.byteLength <= 25 * 1024 * 1024) {
            const { transcribeWithGroq, analyzeWithGroq } = await import("@/lib/groq-client");
            const transcript = await transcribeWithGroq(audioBuffer, apiKey, language);
            const analysis = await analyzeWithGroq(transcript.text, transcript.segments, apiKey, language);

            return NextResponse.json({
              ...info,
              transcript: transcript.text,
              segments: transcript.segments,
              ...analysis,
              provider: "groq",
            });
          }
        }
      } catch (groqErr) {
        console.error("Groq error:", groqErr);
      }
    }

    return NextResponse.json({
      ...info,
      note: info.audioUrl
        ? "Video encontrado com sucesso. Adicione chave Groq (gratis) para transcricao IA."
        : "Video encontrado, mas nao foi possivel extrair audio.",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Erro interno. Tente novamente." },
      { status: 500 }
    );
  }
}
