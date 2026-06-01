import { NextRequest, NextResponse } from "next/server";
// @ts-ignore
import ytdl from "@distube/ytdl-core";

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
  try {
    const info = await ytdl.getInfo(videoId);
    const formats = info.formats;

    // Pick best audio (opus > m4a)
    const audioFormat =
      formats.find((f: { hasAudio: boolean; hasVideo: boolean; codecs?: string }) =>
        f.hasAudio && !f.hasVideo && f.codecs?.includes("opus")
      ) ||
      formats.find((f: { hasAudio: boolean; hasVideo: boolean }) =>
        f.hasAudio && !f.hasVideo
      );

    // Pick best video (720p mp4)
    const videoFormat =
      formats.find((f: { hasVideo: boolean; hasAudio: boolean; qualityLabel?: string; container?: string }) =>
        f.hasVideo && !f.hasAudio && f.qualityLabel === "720p" && f.container === "mp4"
      ) ||
      formats.find((f: { hasVideo: boolean; hasAudio: boolean; container?: string }) =>
        f.hasVideo && !f.hasAudio && f.container === "mp4"
      );

    // Get best thumbnail
    const thumbs = info.videoDetails.thumbnails || [];
    const bestThumb = thumbs[thumbs.length - 1]?.url || thumbs[0]?.url || "";

    return {
      videoId,
      title: info.videoDetails.title,
      duration: parseInt(info.videoDetails.lengthSeconds || "0", 10),
      thumbnail: bestThumb,
      audioUrl: audioFormat?.url || null,
      videoUrl: videoFormat?.url || null,
      audioFormat: audioFormat
        ? { itag: audioFormat.itag, mimeType: audioFormat.mimeType, contentLength: audioFormat.contentLength }
        : null,
      videoFormat: videoFormat
        ? { itag: videoFormat.itag, mimeType: videoFormat.mimeType, contentLength: videoFormat.contentLength }
        : null,
    };
  } catch (err) {
    console.error("ytdl error:", err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { url, language = "pt", apiKey } = await req.json();
    if (!url) return NextResponse.json({ error: "URL obrigatoria" }, { status: 400 });

    const videoId = extractVideoId(url);
    if (!videoId) return NextResponse.json({ error: "URL invalida do YouTube" }, { status: 400 });

    // Get video info via ytdl-core (pure JS, no external deps)
    const info = await getVideoInfo(videoId);
    if (!info) {
      return NextResponse.json({ error: "Video nao encontrado ou indisponivel" }, { status: 404 });
    }

    // Download audio if Groq key provided
    if (apiKey && info.audioUrl) {
      try {
        const audioRes = await fetch(info.audioUrl, { signal: AbortSignal.timeout(120000) });
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

    // Return video metadata
    return NextResponse.json({
      ...info,
      note: "Video encontrado. Adicione chave Groq (gratis) para transcricao com IA e deteccao de topicos.",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro interno" },
      { status: 500 }
    );
  }
}
