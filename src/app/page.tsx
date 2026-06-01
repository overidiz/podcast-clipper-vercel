"use client";

import { useState } from "react";
import {
  Scissors, Film, Clock, Image as ImageIcon, Tags, Download,
  Sparkles, Pencil, Copy, Zap, Hash, FileText,
} from "lucide-react";
import { toast } from "sonner";
import { extractKeywords, generateTags, generateHashtags, formatForExport } from "@/lib/seo";
import { generateAllThumbnailsFromImage } from "@/lib/thumbnail";

interface Topic {
  index: number;
  title: string;
  summary: string;
  start: number;
  end: number;
  duration: number;
}

interface VideoData {
  videoId: string;
  title: string;
  duration: number;
  thumbnail: string;
  formats: { url: string; mimeType: string; itag: number; contentLength?: string }[];
}

const CORS_PROXY = "https://api.allorigins.win/raw?url=";

function extractVideoId(url: string): string {
  const p = /(?:v=|\/v\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const m = url.match(p);
  if (m) return m[1];
  throw new Error("URL invalida");
}

async function fetchViaProxy(url: string): Promise<string> {
  // Try multiple CORS proxies
  const proxies = [
    (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
  ];

  for (const proxyFn of proxies) {
    try {
      const res = await fetch(proxyFn(url), { signal: AbortSignal.timeout(15000) });
      if (res.ok) return await res.text();
    } catch {}
  }
  throw new Error("Nao foi possivel acessar o YouTube. Tente novamente.");
}

async function getVideoFromYouTube(url: string): Promise<VideoData> {
  const videoId = extractVideoId(url);

  // Try InnerTube API first
  try {
    const keyRes = await fetchViaProxy("https://www.youtube.com/");
    const keyMatch = keyRes.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
    const apiKey = keyMatch?.[1] || "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

    const innerTubeUrl = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}`;
    const innerTubeBody = JSON.stringify({
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
    });

    // POST to InnerTube via proxy
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(innerTubeUrl)}`;
    const proxyBody = `https://corsproxy.io/?${encodeURIComponent(`__POST__${encodeURIComponent(innerTubeBody)}`)}`;

    // Actually, we need to POST. Let's try fetch directly with no-cors
    try {
      const directRes = await fetch(innerTubeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: innerTubeBody,
        signal: AbortSignal.timeout(12000),
      });
      if (directRes.ok) {
        const data = await directRes.json();
        if (data.videoDetails) {
          return parseVideoData(videoId, data);
        }
      }
    } catch {}

    // Fallback: fetch watch page via proxy
    const html = await fetchViaProxy(`https://www.youtube.com/watch?v=${videoId}`);

    // Extract ytInitialPlayerResponse
    const start = html.indexOf("ytInitialPlayerResponse");
    if (start === -1) throw new Error("Video nao encontrado");

    const braceStart = html.indexOf("{", start);
    let depth = 0, endIdx = braceStart;
    for (let i = braceStart; i < html.length; i++) {
      if (html[i] === "{") depth++;
      else if (html[i] === "}" && --depth === 0) { endIdx = i + 1; break; }
    }

    const data = JSON.parse(html.slice(braceStart, endIdx));
    return parseVideoData(videoId, data);
  } catch (e) {
    throw e instanceof Error ? e : new Error("Erro ao acessar video");
  }
}

function parseVideoData(videoId: string, data: Record<string, unknown>): VideoData {
  const details = data.videoDetails as Record<string, unknown> || {};
  const streamingData = data.streamingData as Record<string, unknown> || {};
  const rawFormats = [
    ...(streamingData.adaptiveFormats as Record<string, unknown>[] || []),
    ...(streamingData.formats as Record<string, unknown>[] || []),
  ];

  const formats = rawFormats.map((f: Record<string, unknown>) => {
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
      itag: (f.itag as number) || 0,
      contentLength: f.contentLength as string | undefined,
    };
  }).filter(f => f.url);

  const thumbs = ((details.thumbnail as Record<string, unknown>)?.thumbnails as { url: string }[]) || [];

  return {
    videoId,
    title: (details.title as string) || "Video",
    duration: parseInt((details.lengthSeconds as string) || "0", 10),
    thumbnail: thumbs[thumbs.length - 1]?.url || "",
    formats,
  };
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

type Tab = "topics" | "thumbs" | "export";

export default function Home() {
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [language, setLanguage] = useState("pt");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [videoData, setVideoData] = useState<VideoData | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [thumbnails, setThumbnails] = useState<{ index: number; title: string; url: string }[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("topics");
  const [generatingThumbs, setGeneratingThumbs] = useState(false);
  const [seoTags, setSeoTags] = useState<string[]>([]);
  const [seoHashtags, setSeoHashtags] = useState<string[]>([]);
  const [seoDescription, setSeoDescription] = useState("");
  const [cutScript, setCutScript] = useState("");

  const handleSubmit = async () => {
    if (!url) return;
    setLoading(true);
    setStatus("Extraindo video...");
    setVideoData(null);
    setTopics([]);
    setThumbnails([]);

    try {
      const data = await getVideoFromYouTube(url);
      setVideoData(data);
      setStatus("Video extraido com sucesso!");

      // If Groq key, do AI processing
      if (apiKey && data.formats.length > 0) {
        const audioFmt = data.formats.find(f =>
          f.mimeType.includes("audio")
        );

        if (audioFmt) {
          setStatus("Baixando audio...");
          try {
            const audioRes = await fetch(audioFmt.url, { signal: AbortSignal.timeout(120000) });
            if (audioRes.ok) {
              const buffer = await audioRes.arrayBuffer();
              if (buffer.byteLength <= 25 * 1024 * 1024) {
                setStatus("Transcrevendo com IA...");
                const { transcribeWithGroq, analyzeWithGroq } = await import("@/lib/groq-client");
                const transcript = await transcribeWithGroq(buffer, apiKey, language);
                const analysis = await analyzeWithGroq(transcript.text, transcript.segments, apiKey, language);

                if (analysis.topics.length > 0) {
                  setTopics(analysis.topics);
                  setSeoTags(analysis.tags);
                  setSeoHashtags(analysis.hashtags);
                  setSeoDescription(analysis.seoDescription);
                  generateCutScript(analysis.topics, data.videoId);
                  setLoading(false);
                  setStatus("");
                  toast.success(`${analysis.topics.length} topicos via IA!`);
                  return;
                }
              }
            }
          } catch {}
        }
      }

      // Local mode: basic metadata only
      const keywords = extractKeywords(data.title);
      setSeoTags(generateTags(keywords));
      setSeoHashtags(generateHashtags(keywords));
      setSeoDescription(`${data.title}. ${Math.floor(data.duration / 60)}min de conteudo.`);

      setLoading(false);
      setStatus("");
      toast.success("Video encontrado! Adicione chave Groq para IA.");
    } catch (e) {
      setLoading(false);
      setStatus("");
      toast.error(e instanceof Error ? e.message : "Erro ao acessar video");
    }
  };

  const generateCutScript = (t: Topic[], vid: string) => {
    const lines = [
      "#!/bin/bash",
      "# Podcast Clipper — Corte de Video",
      `# Video: https://youtube.com/watch?v=${vid}`,
      "",
      `yt-dlp -f "bestvideo[height<=1080]+bestaudio/best[height<=1080]" -o "${vid}.mp4" "https://youtube.com/watch?v=${vid}"`,
      `INPUT="${vid}.mp4"`,
      "mkdir -p clips",
      "",
    ];
    t.forEach((topic) => {
      const safe = topic.title.replace(/[<>:"/\\|?*]/g, "").slice(0, 50);
      lines.push(
        `echo "🎬 ${topic.title}"`,
        `ffmpeg -y -ss ${topic.start.toFixed(1)} -i "$INPUT" -t ${(topic.duration + 1).toFixed(1)} -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k "clips/${String(topic.index).padStart(2, "0")}_${safe}.mp4"`,
        "",
      );
    });
    lines.push(`echo "✅ ${t.length} cortes em clips/"`);
    setCutScript(lines.join("\n"));
  };

  const generateThumbnails = async () => {
    if (!videoData?.thumbnail) return;
    setGeneratingThumbs(true);
    try {
      if (topics.length > 0) {
        const thumbs = await generateAllThumbnailsFromImage(
          videoData.thumbnail,
          topics.map(t => ({ index: t.index, title: t.title })),
          { accentColor: "#eab308" }
        );
        setThumbnails(thumbs);
      } else {
        // Generate single thumbnail for the whole video
        const thumbs = await generateAllThumbnailsFromImage(
          videoData.thumbnail,
          [{ index: 1, title: videoData.title }],
          { accentColor: "#eab308" }
        );
        setThumbnails(thumbs);
        setTopics([{ index: 1, title: videoData.title, summary: "", start: 0, end: videoData.duration, duration: videoData.duration }]);
      }
      setActiveTab("thumbs");
      toast.success("Thumbnails geradas!");
    } catch {
      toast.error("Erro ao gerar thumbnails");
    }
    setGeneratingThumbs(false);
  };

  const updateTopic = (index: number, field: keyof Topic, value: string | number) => {
    setTopics(prev => prev.map(t => t.index === index ? { ...t, [field]: value } : t));
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado!`);
  };

  return (
    <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 sm:py-10">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-tint/10 text-tint text-sm font-medium mb-4">
          <Zap className="w-4 h-4" />
          100% Gratuito — client-side
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-3">Podcast Clipper</h1>
        <p className="text-muted-foreground text-lg max-w-lg mx-auto">
          Cortes com titulos, thumbnails e SEO. Tudo no seu navegador.
        </p>
      </div>

      {/* Input */}
      <div className="bg-card border rounded-2xl p-5 mb-8">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <Film className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <input
                type="text" placeholder="https://www.youtube.com/watch?v=..."
                value={url} onChange={e => setUrl(e.target.value)} disabled={loading}
                className="w-full h-12 pl-10 pr-4 bg-background border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
            </div>
            <select value={language} onChange={e => setLanguage(e.target.value)} disabled={loading}
              className="h-12 px-3 bg-background border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="pt">Portugues</option>
              <option value="en">English</option>
              <option value="es">Espanol</option>
              <option value="auto">Auto</option>
            </select>
            <button onClick={handleSubmit} disabled={loading || !url}
              className="h-12 px-6 bg-tint text-tint-foreground rounded-xl font-medium text-sm hover:opacity-90 disabled:opacity-50 flex items-center gap-2 shrink-0">
              {loading ? <><div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />{status}</>
                : <><Scissors className="w-4 h-4" />Processar</>}
            </button>
          </div>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground">Usar Groq API (gratis — transcricao IA + topicos)</summary>
            <div className="mt-2 flex gap-2">
              <input type="password" placeholder="Groq API Key (console.groq.com)"
                value={apiKey} onChange={e => setApiKey(e.target.value)} disabled={loading}
                className="flex-1 h-9 px-3 bg-background border rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50" />
            </div>
          </details>
        </div>
      </div>

      {/* Results */}
      {videoData && (
        <div className="space-y-6">
          <div className="bg-card border rounded-xl p-4">
            <h2 className="font-semibold mb-1">{videoData.title}</h2>
            <p className="text-sm text-muted-foreground">{Math.floor(videoData.duration / 60)}min • {videoData.formats.length} formatos</p>
          </div>

          {topics.length > 0 && (
            <>
              <div className="flex gap-1 bg-muted rounded-xl p-1">
                {([["topics","Topicos",Pencil],["thumbs","Thumbnails",ImageIcon],["export","Exportar",Download]] as const).map(([tab,label,Icon]) => (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                    className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium ${activeTab===tab?"bg-background text-foreground shadow-sm":"text-muted-foreground hover:text-foreground"}`}>
                    <Icon className="w-4 h-4" />{label}
                  </button>
                ))}
              </div>

              {activeTab === "topics" && (
                <div className="space-y-3">
                  {topics.map(topic => (
                    <div key={topic.index} className="bg-card border rounded-xl p-4">
                      <div className="flex items-start gap-3">
                        <span className="text-xs font-mono bg-tint/10 text-tint px-2 py-1 rounded mt-1">#{topic.index}</span>
                        <div className="flex-1">
                          <input type="text" value={topic.title} onChange={e => updateTopic(topic.index,"title",e.target.value)}
                            className="w-full bg-transparent font-semibold text-sm focus:outline-none focus:ring-1 focus:ring-ring rounded px-1 -mx-1" />
                          <div className="text-xs text-muted-foreground mt-1">
                            <span className="bg-muted px-2 py-0.5 rounded font-mono">{formatTime(topic.start)} → {formatTime(topic.end)}</span>
                            <span className="ml-2">{Math.floor(topic.duration)}s</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{topic.summary}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeTab === "thumbs" && (
                <div className="space-y-4">
                  {thumbnails.length === 0 ? (
                    <div className="text-center py-12 bg-card border rounded-2xl">
                      <ImageIcon className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                      <button onClick={generateThumbnails} disabled={generatingThumbs}
                        className="px-5 py-2.5 bg-tint text-tint-foreground rounded-xl text-sm font-medium">
                        {generatingThumbs ? "Gerando..." : `Gerar ${topics.length} Thumbnails`}
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {thumbnails.map(t => (
                        <div key={t.index} className="bg-card border rounded-xl overflow-hidden">
                          <img src={t.url} alt={t.title} className="w-full aspect-video object-cover" />
                          <div className="p-3 flex justify-between items-center">
                            <span className="text-xs truncate flex-1 mr-2">{t.title}</span>
                            <a href={t.url} download={`thumb_${t.index}.jpg`} className="text-xs text-tint hover:underline"><Download className="w-3 h-3 inline" /> Baixar</a>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "export" && (
                <div className="space-y-4">
                  <div className="bg-card border rounded-xl p-4">
                    <div className="flex justify-between mb-3"><h3 className="text-sm font-medium"><Tags className="w-4 h-4 inline mr-1" />Descricao</h3><button onClick={()=>copyToClipboard(seoDescription,"Descricao")} className="text-xs text-tint"><Copy className="w-3 h-3 inline" /> Copiar</button></div>
                    <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">{seoDescription}</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-card border rounded-xl p-4">
                      <div className="flex justify-between mb-3"><h3 className="text-sm font-medium"><Hash className="w-4 h-4 inline mr-1" />Hashtags</h3><button onClick={()=>copyToClipboard(seoHashtags.join(" "),"Hashtags")} className="text-xs text-tint"><Copy className="w-3 h-3 inline" /> Copiar</button></div>
                      <div className="flex flex-wrap gap-1.5">{seoHashtags.map(t=><span key={t} className="text-xs bg-tint/5 text-tint px-2 py-1 rounded-full">{t}</span>)}</div>
                    </div>
                    <div className="bg-card border rounded-xl p-4">
                      <div className="flex justify-between mb-3"><h3 className="text-sm font-medium"><Tags className="w-4 h-4 inline mr-1" />Tags</h3><button onClick={()=>copyToClipboard(seoTags.join(", "),"Tags")} className="text-xs text-tint"><Copy className="w-3 h-3 inline" /> Copiar</button></div>
                      <div className="flex flex-wrap gap-1.5">{seoTags.map(t=><span key={t} className="text-xs bg-secondary text-secondary-foreground px-2 py-1 rounded-full">{t}</span>)}</div>
                    </div>
                  </div>
                  {cutScript && (
                    <div className="bg-card border rounded-xl overflow-hidden">
                      <div className="flex justify-between px-4 py-3 border-b bg-muted/50"><span className="text-sm font-medium"><Download className="w-4 h-4 inline mr-1" />Script de Corte</span><button onClick={()=>copyToClipboard(cutScript,"Script")} className="text-xs text-tint"><Copy className="w-3 h-3 inline" /> Copiar</button></div>
                      <pre className="p-4 text-xs font-mono text-muted-foreground overflow-x-auto max-h-80">{cutScript}</pre>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {topics.length === 0 && videoData && (
            <div className="text-center py-8 bg-card border rounded-2xl">
              <Sparkles className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground mb-2">Adicione a chave Groq (gratis) para transcricao com IA e deteccao de topicos.</p>
              <button onClick={generateThumbnails} className="text-sm text-tint hover:underline">Gerar thumbnail do video</button>
            </div>
          )}
        </div>
      )}

      {!loading && !videoData && (
        <div className="text-center py-16">
          <div className="w-24 h-24 mx-auto mb-6 rounded-3xl bg-muted flex items-center justify-center"><Scissors className="w-10 h-10 text-muted-foreground" /></div>
          <h2 className="text-xl font-semibold mb-3">Cole um link do YouTube</h2>
          <p className="text-sm text-muted-foreground">Tudo roda no seu navegador. Com Groq API key = IA gratuita.</p>
        </div>
      )}
    </main>
  );
}
