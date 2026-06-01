import { NextRequest, NextResponse } from "next/server";

function extractVideoId(url: string): string | null {
  const p = /(?:v=|\/v\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const m = url.match(p);
  return m ? m[1] : null;
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url) return NextResponse.json({ error: "URL obrigatoria" }, { status: 400 });

    const videoId = extractVideoId(url);
    if (!videoId) return NextResponse.json({ error: "URL invalida" }, { status: 400 });

    // Get metadata via oEmbed (works for ALL public YouTube videos)
    let title = "";
    let thumbnail = "";

    try {
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (oembedRes.ok) {
        const oembed = await oembedRes.json();
        title = oembed.title || "";
        thumbnail = oembed.thumbnail_url || "";
      }
    } catch {}

    // Try to get player data for formats (may fail for some videos due to IP blocking)
    let formats: Record<string, unknown>[] = [];
    let duration = 0;

    try {
      const htmlRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept-Language": "pt-BR,pt;q=0.9",
        },
        signal: AbortSignal.timeout(12000),
      });

      if (htmlRes.ok) {
        const html = await htmlRes.text();
        const start = html.indexOf("ytInitialPlayerResponse");
        if (start !== -1) {
          const braceStart = html.indexOf("{", start);
          if (braceStart !== -1) {
            let depth = 0, endIdx = braceStart;
            for (let i = braceStart; i < html.length; i++) {
              if (html[i] === "{") depth++;
              else if (html[i] === "}" && --depth === 0) { endIdx = i + 1; break; }
            }
            const data = JSON.parse(html.slice(braceStart, endIdx));

            if (data.videoDetails) {
              if (!title) title = (data.videoDetails.title as string) || "";
              duration = parseInt((data.videoDetails.lengthSeconds as string) || "0", 10);
            }

            const sd = data.streamingData || {};
            const rawFormats = [...(sd.adaptiveFormats || []), ...(sd.formats || [])];
            formats = rawFormats
              .map((f: Record<string, unknown>) => {
                let u = (f.url as string) || "";
                if (!u && f.signatureCipher) {
                  const p = new URLSearchParams(f.signatureCipher as string);
                  u = p.get("url") || "";
                  const s = p.get("s") || "";
                  if (s) u += `&sig=${s}`;
                }
                return {
                  url: u,
                  mimeType: (f.mimeType as string) || "",
                  itag: f.itag,
                  contentLength: f.contentLength,
                  qualityLabel: f.qualityLabel,
                };
              })
              .filter((f: Record<string, unknown>) => f.url);
          }
        }
      }
    } catch {}

    // Always return video metadata (at minimum oembed data)
    return NextResponse.json({
      videoId,
      title: title || "Video do YouTube",
      duration,
      thumbnail: thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      formats,
      hasFormats: formats.length > 0,
      note: formats.length === 0
        ? "Metadados extraidos via oEmbed. Formatos de video precisam ser extraidos no navegador."
        : undefined,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
