import { NextRequest, NextResponse } from "next/server";

function extractVideoId(url: string): string | null {
  const p = /(?:v=|\/v\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const m = url.match(p);
  return m ? m[1] : url.length === 11 ? url : null;
}

const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

interface Format {
  url?: string;
  signatureCipher?: string;
  mimeType?: string;
  itag?: number;
  qualityLabel?: string;
  audioBitrate?: number;
}

async function getVideoFromInnerTube(videoId: string) {
  const res = await fetch(
    `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      },
      body: JSON.stringify({
        videoId,
        context: {
          client: {
            clientName: "WEB",
            clientVersion: "2.20250601.00.00",
            hl: "pt",
            gl: "BR",
          },
        },
        playbackContext: { contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS" } },
      }),
      signal: AbortSignal.timeout(12000),
    }
  );

  if (!res.ok) return null;
  return res.json();
}

function resolveUrl(f: Format): string {
  if (f.url) return f.url;
  if (f.signatureCipher) {
    const p = new URLSearchParams(f.signatureCipher);
    const url = p.get("url") || "";
    const s = p.get("s") || "";
    if (s) return `${url}&sig=${s}`;
    return url;
  }
  return "";
}

async function getVideoFormats(videoId: string) {
  // Try InnerTube API first
  let data = await getVideoFromInnerTube(videoId);

  // Fallback: try HTML parsing
  if (!data?.streamingData) {
    try {
      const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
          "Accept-Language": "pt-BR",
        },
        signal: AbortSignal.timeout(12000),
      });
      if (pageRes.ok) {
        const html = await pageRes.text();
        const start = html.indexOf("ytInitialPlayerResponse") ;
        if (start !== -1) {
          const braceStart = html.indexOf("{", start);
          if (braceStart !== -1) {
            let depth = 0, endIdx = braceStart;
            for (let i = braceStart; i < html.length; i++) {
              if (html[i] === "{") depth++;
              else if (html[i] === "}" && --depth === 0) { endIdx = i + 1; break; }
            }
            try { data = JSON.parse(html.slice(braceStart, endIdx)); } catch {}
          }
        }
      }
    } catch {}
  }

  if (!data?.streamingData) return null;

  const details = data.videoDetails || {};
  const rawFormats: Format[] = [
    ...(data.streamingData.adaptiveFormats || []),
    ...(data.streamingData.formats || []),
  ];

  // Resolve URLs
  const formats = rawFormats.map((f) => ({ ...f, url: resolveUrl(f) }));

  // Pick best audio
  const audio = formats.find((f: Format) =>
    f.url && (f.mimeType?.includes("audio") || !!f.audioBitrate)
  );

  // Pick best video (720p mp4)
  const video = formats.find((f: Format) =>
    f.url && f.mimeType?.includes("video/mp4")
  );

  const thumbs = (details.thumbnail?.thumbnails as { url: string }[]) || [];

  return {
    videoId,
    title: (details.title as string) || "Video",
    duration: parseInt((details.lengthSeconds as string) || "0", 10),
    thumbnail: thumbs[thumbs.length - 1]?.url || "",
    audioUrl: audio?.url || null,
    videoUrl: video?.url || null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const { url, language = "pt", apiKey } = await req.json();
    if (!url) return NextResponse.json({ error: "URL obrigatoria" }, { status: 400 });

    const videoId = extractVideoId(url);
    if (!videoId) return NextResponse.json({ error: "URL invalida" }, { status: 400 });

    const info = await getVideoFormats(videoId);
    if (!info) {
      return NextResponse.json({
        error: "Nao foi possivel acessar o video. Tente outro link.",
      }, { status: 404 });
    }

    // If Groq key provided + audio available, transcribe
    if (apiKey && info.audioUrl) {
      try {
        const audioRes = await fetch(info.audioUrl, { signal: AbortSignal.timeout(120000) });
        if (audioRes.ok) {
          const audioBuffer = await audioRes.arrayBuffer();
          if (audioBuffer.byteLength <= 25 * 1024 * 1024) {
            const { transcribeWithGroq, analyzeWithGroq } = await import("@/lib/groq-client");
            const transcript = await transcribeWithGroq(audioBuffer, apiKey, language);
            const analysis = await analyzeWithGroq(transcript.text, transcript.segments, apiKey, language);
            return NextResponse.json({ ...info, transcript: transcript.text, segments: transcript.segments, ...analysis, provider: "groq" });
          }
        }
      } catch (e) { console.error("Groq error:", e); }
    }

    return NextResponse.json({
      ...info,
      note: info.audioUrl ? "Video encontrado. Adicione chave Groq (gratis) para IA." : "Metadados extraidos.",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
