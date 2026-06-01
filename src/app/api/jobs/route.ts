import { NextRequest, NextResponse } from "next/server";

function extractVideoId(url: string): string | null {
  const p = /(?:v=|\/v\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const m = url.match(p);
  return m ? m[1] : null;
}

async function fetchWithProxy(url: string): Promise<string | null> {
  // Try direct first, then via proxy
  try {
    const direct = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (direct.ok) return await direct.text();
  } catch {}

  // Via CORS proxy
  const proxies = [
    (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  ];

  for (const proxyFn of proxies) {
    try {
      const res = await fetch(proxyFn(url), { signal: AbortSignal.timeout(12000) });
      if (res.ok) return await res.text();
    } catch {}
  }
  return null;
}

async function getFormats(videoId: string) {
  // Method 1: InnerTube API via proxy
  const apiKey = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
  const innerBody = JSON.stringify({
    videoId,
    context: {
      client: { clientName: "WEB", clientVersion: "2.20250601.00.00", hl: "pt", gl: "BR", utcOffsetMinutes: -180 },
    },
  });

  try {
    const innerRes = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: innerBody,
        signal: AbortSignal.timeout(10000),
      }
    );
    if (innerRes.ok) {
      const data = await innerRes.json();
      if (data.videoDetails) {
        return extractFormats(data);
      }
    }
  } catch {}

  // Method 2: YouTube watch page via proxy
  const html = await fetchWithProxy(`https://www.youtube.com/watch?v=${videoId}`);
  if (html) {
    const start = html.indexOf("ytInitialPlayerResponse");
    if (start !== -1) {
      const braceStart = html.indexOf("{", start);
      if (braceStart !== -1) {
        let depth = 0, endIdx = braceStart;
        for (let i = braceStart; i < html.length; i++) {
          if (html[i] === "{") depth++;
          else if (html[i] === "}" && --depth === 0) { endIdx = i + 1; break; }
        }
        try {
          return extractFormats(JSON.parse(html.slice(braceStart, endIdx)));
        } catch {}
      }
    }
  }

  return null;
}

function extractFormats(data: Record<string, unknown>) {
  const details = data.videoDetails as Record<string, unknown> || {};
  const sd = data.streamingData as Record<string, unknown> || {};
  const raw = [...(sd.adaptiveFormats as Record<string, unknown>[] || []), ...(sd.formats as Record<string, unknown>[] || [])];
  const formats = raw
    .map((f: Record<string, unknown>) => {
      let u = (f.url as string) || "";
      if (!u && f.signatureCipher) {
        const p = new URLSearchParams(f.signatureCipher as string);
        u = p.get("url") || "";
        const s = p.get("s") || "";
        if (s) u += `&sig=${s}`;
      }
      return { url: u, mimeType: (f.mimeType as string) || "", itag: f.itag, contentLength: f.contentLength, qualityLabel: f.qualityLabel };
    })
    .filter((f) => f.url);

  const thumbs = ((details.thumbnail as Record<string, unknown>)?.thumbnails as { url: string }[]) || [];

  return {
    title: (details.title as string) || "",
    duration: parseInt((details.lengthSeconds as string) || "0", 10),
    thumbnail: thumbs[thumbs.length - 1]?.url || "",
    formats,
  };
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url) return NextResponse.json({ error: "URL obrigatoria" }, { status: 400 });

    const videoId = extractVideoId(url);
    if (!videoId) return NextResponse.json({ error: "URL invalida" }, { status: 400 });

    // Get formats (InnerTube direct + YouTube page via proxy as fallback)
    let data = await getFormats(videoId);
    let title = data?.title || "";
    let duration = data?.duration || 0;
    let thumbnail = data?.thumbnail || "";
    let formats = data?.formats || [];

    // Fallback: oEmbed for metadata only
    if (!title) {
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
    }

    if (!title) title = "Video do YouTube";
    if (!thumbnail) thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    return NextResponse.json({
      videoId, title, duration, thumbnail, formats,
      hasFormats: formats.length > 0,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
