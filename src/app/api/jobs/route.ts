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

    let title = "";
    let thumbnail = "";
    let duration = 0;

    // oEmbed — always works for public videos
    try {
      const res = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (res.ok) {
        const data = await res.json();
        title = data.title || "";
        thumbnail = data.thumbnail_url || "";
      }
    } catch {}

    if (!title) title = "Video do YouTube";
    if (!thumbnail) thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    // Try get duration from InnerTube
    try {
      const innerRes = await fetch(
        `https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
          duration = parseInt((data.videoDetails.lengthSeconds as string) || "0", 10);
        }
      }
    } catch {}

    return NextResponse.json({
      videoId, title, duration, thumbnail,
      formats: [],
      note: "Para cortar o video, use o upload de arquivo MP4 abaixo.",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
