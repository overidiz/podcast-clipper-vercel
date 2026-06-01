import { NextRequest, NextResponse } from "next/server";

function extractVideoId(url: string): string | null {
  const p = /(?:v=|\/v\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const m = url.match(p);
  return m ? m[1] : null;
}

async function fetchWithRetry(url: string, options: RequestInit = {}, retries = 3): Promise<string | null> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
      if (res.ok) return await res.text();
    } catch {}
  }
  return null;
}

async function proxyFetch(url: string): Promise<string | null> {
  const proxies = [
    (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    (u: string) => `https://thingproxy.freeboard.io/fetch/${encodeURIComponent(u)}`,
  ];
  for (const fn of proxies) {
    const html = await fetchWithRetry(fn(url));
    if (html) return html;
  }
  return null;
}

function parsePlayerResponse(html: string) {
  const start = html.indexOf("ytInitialPlayerResponse");
  if (start === -1) return null;
  const braceStart = html.indexOf("{", start);
  if (braceStart === -1) return null;
  let depth = 0, endIdx = braceStart;
  for (let i = braceStart; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}" && --depth === 0) { endIdx = i + 1; break; }
  }
  try { return JSON.parse(html.slice(braceStart, endIdx)); }
  catch { return null; }
}

function extractFormats(data: Record<string, unknown>) {
  const sd = data.streamingData as Record<string, unknown> || {};
  const raw = [...(sd.adaptiveFormats as Record<string, unknown>[] || []), ...(sd.formats as Record<string, unknown>[] || [])];
  return raw
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
    .filter((f: { url: string }) => f.url);
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url) return NextResponse.json({ error: "URL obrigatoria" }, { status: 400 });

    const videoId = extractVideoId(url);
    if (!videoId) return NextResponse.json({ error: "URL invalida" }, { status: 400 });

    let title = "";
    let duration = 0;
    let thumbnail = "";
    let formats: Record<string, unknown>[] = [];

    // 1. Try direct InnerTube API (works for some videos from Vercel IPs)
    try {
      const innerRes = await fetch(
        `https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
          body: JSON.stringify({
            videoId,
            context: { client: { clientName: "WEB", clientVersion: "2.20250601.00.00", hl: "pt", gl: "BR" } },
          }),
          signal: AbortSignal.timeout(10000),
        }
      );
      if (innerRes.ok) {
        const data = await innerRes.json();
        if (data.videoDetails) {
          const d = data.videoDetails;
          title = (d.title as string) || title;
          duration = parseInt((d.lengthSeconds as string) || "0", 10) || duration;
          formats = extractFormats(data);
        }
      }
    } catch {}

    // 2. Try watch page via proxy (bypasses Vercel IP blocking)
    if (!formats.length) {
      const html = await proxyFetch(`https://www.youtube.com/watch?v=${videoId}`);
      if (html) {
        const playerData = parsePlayerResponse(html);
        if (playerData?.videoDetails) {
          const d = playerData.videoDetails as Record<string, unknown>;
          title = (d.title as string) || title;
          duration = parseInt((d.lengthSeconds as string) || "0", 10) || duration;
          const thumbs = (d.thumbnail as Record<string, unknown>)?.thumbnails as { url: string }[] || [];
          thumbnail = thumbs[thumbs.length - 1]?.url || "";
          formats = extractFormats(playerData);
        }
      }
    }

    // 3. oEmbed for remaining metadata (always works)
    if (!title) {
      try {
        const oembedRes = await fetch(
          `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (oembedRes.ok) {
          const oembed = await oembedRes.json();
          title = oembed.title || "";
          thumbnail = oembed.thumbnail_url || thumbnail;
        }
      } catch {}
    }

    if (!title) title = "Video do YouTube";
    if (!thumbnail) thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    return NextResponse.json({
      videoId, title, duration, thumbnail, formats,
      hasFormats: formats.length > 0,
      note: formats.length === 0 ? "Formatos nao disponiveis no servidor. O navegador tentara extrair..." : undefined,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
