import { NextRequest, NextResponse } from "next/server";

function extractVideoId(url: string): string | null {
  const p = /(?:v=|\/v\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const m = url.match(p);
  return m ? m[1] : null;
}

const INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net",
  "https://invidious.fdn.fr",
  "https://yewtu.be",
  "https://vid.puffyan.us",
  "https://invidious.privacyredirect.com",
  "https://iv.ggtyler.dev",
];

async function fetchInvidious(videoId: string) {
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      const res = await fetch(`${base}/api/v1/videos/${videoId}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const data = await res.json();

      const formats = (data.adaptiveFormats || [])
        .concat(data.formatStreams || [])
        .filter((f: Record<string, unknown>) => f.url)
        .map((f: Record<string, unknown>) => ({
          url: f.url as string,
          mimeType: (f.type as string) || (f.mimeType as string) || "",
          itag: (f.itag as number) || 0,
          contentLength: (f.clen as string) || (f.contentLength as string) || undefined,
          qualityLabel: (f.qualityLabel as string) || (f.resolution as string) || undefined,
        }));

      return {
        title: data.title as string || "",
        duration: (data.lengthSeconds as number) || 0,
        thumbnail: (data.videoThumbnails?.[0]?.url as string) || "",
        formats,
      };
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchOEmbed(videoId: string) {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (res.ok) {
      const data = await res.json();
      return {
        title: data.title as string || "",
        thumbnail: data.thumbnail_url as string || "",
      };
    }
  } catch {}
  return { title: "", thumbnail: "" };
}

async function fetchYouTubeHtml(videoId: string) {
  for (const ua of [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
  ]) {
    try {
      const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: {
          "User-Agent": ua,
          "Accept-Language": "pt-BR,pt;q=0.9",
          "Accept": "text/html",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const html = await res.text();
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

      const sd = data.streamingData || {};
      const formats = [...(sd.adaptiveFormats || []), ...(sd.formats || [])]
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
            itag: f.itag as number,
            contentLength: f.contentLength as string | undefined,
            qualityLabel: f.qualityLabel as string | undefined,
          };
        })
        .filter((f) => f.url);

      return {
        title: (data.videoDetails.title as string) || "",
        duration: parseInt((data.videoDetails.lengthSeconds as string) || "0", 10),
        thumbnail: "",
        formats,
      };
    } catch { continue; }
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json();
    if (!url) return NextResponse.json({ error: "URL obrigatoria" }, { status: 400 });

    const videoId = extractVideoId(url);
    if (!videoId) return NextResponse.json({ error: "URL invalida" }, { status: 400 });

    // 1. Try Invidious (best - returns formats with CORS-friendly URLs)
    let invidious = await fetchInvidious(videoId);

    // 2. Try YouTube HTML (may be blocked by IP)
    let ytData = await fetchYouTubeHtml(videoId);

    // 3. Always get oEmbed metadata as fallback
    const oembed = await fetchOEmbed(videoId);

    // Build response - prefer Invidious formats, then YouTube, then oEmbed metadata
    const title = invidious?.title || ytData?.title || oembed.title || "Video do YouTube";
    const duration = invidious?.duration || ytData?.duration || 0;
    const thumbnail = invidious?.thumbnail || oembed.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    const formats = invidious?.formats || ytData?.formats || [];

    return NextResponse.json({
      videoId,
      title,
      duration,
      thumbnail,
      formats,
      hasFormats: formats.length > 0,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
