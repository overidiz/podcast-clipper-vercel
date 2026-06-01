import { NextRequest, NextResponse } from "next/server";

function extractVideoId(url: string): string | null {
  const p = /(?:v=|\/v\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const m = url.match(p);
  return m ? m[1] : url.length === 11 ? url : null;
}

async function fetchYouTubePage(videoId: string) {
  // Try multiple approaches to get video data
  const userAgents = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  ];

  for (const ua of userAgents) {
    try {
      const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: {
          "User-Agent": ua,
          "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Cache-Control": "no-cache",
        },
        signal: AbortSignal.timeout(12000),
      });

      if (!res.ok) continue;

      const html = await res.text();

      // Try extracting ytInitialPlayerResponse
      const start = html.indexOf("ytInitialPlayerResponse");
      if (start === -1) continue;

      const braceStart = html.indexOf("{", start);
      if (braceStart === -1) continue;

      let depth = 0, endIdx = braceStart;
      for (let i = braceStart; i < html.length; i++) {
        if (html[i] === "{") depth++;
        else if (html[i] === "}" && --depth === 0) { endIdx = i + 1; break; }
      }

      const data = JSON.parse(html.slice(braceStart, endIdx));

      if (!data.videoDetails) continue;

      const details = data.videoDetails;
      const streamingData = data.streamingData || {};
      const rawFormats = [
        ...(streamingData.adaptiveFormats || []),
        ...(streamingData.formats || []),
      ];

      const formats = rawFormats
        .map((f: Record<string, unknown>) => {
          let url = (f.url as string) || "";
          if (!url && f.signatureCipher) {
            const p = new URLSearchParams(f.signatureCipher as string);
            url = p.get("url") || "";
            const s = p.get("s") || "";
            if (s) url += `&sig=${s}`;
          }
          return {
            url,
            mimeType: (f.mimeType as string) || "",
            itag: f.itag as number,
            contentLength: f.contentLength as string | undefined,
            qualityLabel: f.qualityLabel as string | undefined,
          };
        })
        .filter((f) => f.url);

      const thumbs = (details.thumbnail?.thumbnails as { url: string }[]) || [];

      return {
        videoId,
        title: (details.title as string) || "",
        duration: parseInt((details.lengthSeconds as string) || "0", 10),
        thumbnail: thumbs[thumbs.length - 1]?.url || "",
        formats,
      };
    } catch {
      continue;
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url) return NextResponse.json({ error: "URL obrigatoria" }, { status: 400 });

    const videoId = extractVideoId(url);
    if (!videoId) return NextResponse.json({ error: "URL invalida" }, { status: 400 });

    const data = await fetchYouTubePage(videoId);
    if (!data) {
      return NextResponse.json(
        { error: "Nao foi possivel acessar o video. Verifique se o link esta correto." },
        { status: 404 }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
