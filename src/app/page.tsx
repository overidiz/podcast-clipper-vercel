"use client";

import { useState, useRef } from "react";
import {
  Scissors, Film, Clock, Image as ImageIcon, Tags, Download,
  Sparkles, Pencil, Copy, Zap, Hash, FileText, Upload,
} from "lucide-react";
import { toast } from "sonner";
import { extractKeywords, generateTags, generateHashtags, formatForExport } from "@/lib/seo";
import { generateAllThumbnailsFromImage } from "@/lib/thumbnail";
import { downloadFullVideo, cutVideo, type ClipJob } from "@/lib/clipper-wasm";

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

async function getVideoFromYouTube(url: string): Promise<VideoData> {
  const res = await fetch("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Erro ao acessar video" }));
    throw new Error(err.error || "Video nao encontrado");
  }

  const data = await res.json();

  // Server returned all available formats - use as-is
  return data;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitsPerSample = 16;
  const data = buffer.getChannelData(0);
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = data.length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  // WAV header
  writeString(view, 0, "RIFF");
  view.setUint32(4, totalSize - 8, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < data.length; i++) {
    const sample = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
    offset += 2;
  }
  return arrayBuffer;
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
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
  const [cutting, setCutting] = useState(false);
  const [cutProgress, setCutProgress] = useState({ current: 0, total: 0, status: "" });
  const [clips, setClips] = useState<{ index: number; title: string; blob: Blob; url: string }[]>([]);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

      // AI transcription + analysis (Groq free tier)
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

  const handleCut = async () => {
    if (!videoData || topics.length === 0) return;

    // Find a usable format
    const bestFmt = videoData.formats.find(f => f.url) || null;
    if (!bestFmt?.url) {
      toast.error("Nenhum formato disponivel para download");
      return;
    }

    setCutting(true);
    setClips([]);
    setCutProgress({ current: 0, total: 0, status: "Carregando video..." });

    try {
      let videoBuffer: Uint8Array;

      if (videoFile) {
        // Local file: read directly
        const total = videoFile.size;
        const reader = videoFile.stream().getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          setCutProgress({ current: 0, total: topics.length, status: `Lendo arquivo... ${Math.round((received / total) * 100)}%` });
        }
        videoBuffer = new Uint8Array(received);
        let offset = 0;
        for (const chunk of chunks) {
          videoBuffer.set(chunk, offset);
          offset += chunk.length;
        }
      } else {
        // YouTube format: download from URL
        const sizeMB = bestFmt.contentLength
          ? parseInt(bestFmt.contentLength) / 1024 / 1024
          : 0;
        if (sizeMB > 500) {
          toast.error(`Video muito grande (${sizeMB.toFixed(0)}MB). Use o upload de arquivo.`);
          setCutting(false);
          return;
        }
        videoBuffer = await downloadFullVideo(bestFmt.url, (pct) => {
          setCutProgress({ current: 0, total: topics.length, status: `Baixando video... ${pct}%` });
        });
      }

      // Cut clips
      const clipJobs: ClipJob[] = topics.map(t => ({
        index: t.index,
        title: t.title,
        start: t.start,
        end: t.end,
      }));

      const results = await cutVideo(videoBuffer, clipJobs, (current, total, status) => {
        setCutProgress({ current, total, status });
      });

      const clipsWithUrls = results.map(r => ({
        ...r,
        url: URL.createObjectURL(r.blob),
      }));

      setClips(clipsWithUrls);
      setCutting(false);
      setCutProgress({ current: topics.length, total: topics.length, status: "Concluido!" });
      toast.success(`${clipsWithUrls.length} clips prontos!`);
    } catch (e) {
      setCutting(false);
      setCutProgress({ current: 0, total: 0, status: "" });
      toast.error(e instanceof Error ? e.message : "Erro ao cortar video");
    }
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

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith("video/")) {
      toast.error("Selecione um arquivo de video (MP4)");
      return;
    }
    setVideoFile(file);
    setVideoData({
      videoId: file.name.replace(/\.[^.]+$/, ""),
      title: file.name.replace(/\.[^.]+$/, ""),
      duration: 0,
      thumbnail: "",
      formats: [{ url: URL.createObjectURL(file), mimeType: file.type, itag: 0, contentLength: String(file.size) }],
    });
    setTopics([]);
    setClips([]);
    setThumbnails([]);

    // Try Groq if key provided
    if (apiKey) {
      setLoading(true);
      setStatus("Extraindo audio...");
      try {
        const audioCtx = new AudioContext();
        const arrayBuffer = await file.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        // Convert to WAV
        const wav = audioBufferToWav(audioBuffer);
        if (wav.byteLength <= 25 * 1024 * 1024) {
          setStatus("Transcrevendo com IA...");
          const { transcribeWithGroq, analyzeWithGroq } = await import("@/lib/groq-client");
          const transcript = await transcribeWithGroq(wav, apiKey, language);
          const analysis = await analyzeWithGroq(transcript.text, transcript.segments, apiKey, language);

          if (analysis.topics.length > 0) {
            setTopics(analysis.topics);
            setSeoTags(analysis.tags);
            setSeoHashtags(analysis.hashtags);
            setSeoDescription(analysis.seoDescription);
            generateCutScript(analysis.topics, videoData!.videoId);
            setLoading(false);
            setStatus("");
            toast.success(`${analysis.topics.length} topicos via IA!`);
            return;
          }
        }
      } catch {
        toast.error("Transcricao falhou. Tente sem a chave Groq.");
      }
      setLoading(false);
      setStatus("");
    } else {
      const kw = extractKeywords(file.name);
      setSeoTags(generateTags(kw));
      setSeoHashtags(generateHashtags(kw));
      setSeoDescription(file.name);
      toast.success("Video carregado! Cole a chave Groq para IA ou corte manualmente.");
    }
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
          <details className="text-xs text-muted-foreground mt-2">
            <summary className="cursor-pointer hover:text-foreground">API Groq (gratis — IA pra transcricao + topicos)</summary>
            <div className="flex gap-2 mt-1">
              <input type="password" placeholder="Groq API Key (gratis em console.groq.com)"
                value={apiKey} onChange={e => setApiKey(e.target.value)} disabled={loading}
                className="flex-1 h-9 px-3 bg-background border rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50" />
            </div>
            <p className="mt-1">Sem chave: metadados + corte basico. Com chave: transcricao IA, topicos, titulos e SEO automaticos.</p>
          </details>

          {/* File drop zone */}
          <div
            className="mt-3 border-2 border-dashed rounded-xl p-6 text-center hover:border-tint/50 transition-colors cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add("border-tint"); }}
            onDragLeave={(e) => e.currentTarget.classList.remove("border-tint")}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.classList.remove("border-tint");
              const file = e.dataTransfer.files[0];
              if (file) handleFileUpload(file);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/webm,video/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFileUpload(file);
              }}
            />
            {videoFile ? (
              <div className="flex items-center justify-center gap-2 text-sm">
                <Film className="w-4 h-4 text-tint" />
                <span className="text-tint font-medium">{videoFile.name}</span>
                <span className="text-muted-foreground">({(videoFile.size / 1024 / 1024).toFixed(1)} MB)</span>
                <button
                  onClick={(e) => { e.stopPropagation(); setVideoFile(null); setVideoData(null); setTopics([]); }}
                  className="text-xs text-muted-foreground hover:text-destructive ml-2"
                >
                  remover
                </button>
              </div>
            ) : (
              <div>
                <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Ou arraste um arquivo de video aqui
                </p>
                <p className="text-xs text-muted-foreground mt-1">MP4, WebM — corta sem precisar baixar do YouTube</p>
              </div>
            )}
          </div>
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
                <div className="space-y-4">
                  {/* Topics */}
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

                  {/* Cutting Section */}
                  <div className="bg-card border rounded-2xl p-6">
                    <h3 className="font-semibold flex items-center gap-2 mb-1">
                      <Scissors className="w-5 h-5 text-tint" />
                      Cortar Clipes de Video
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      Baixa o video e corta cada topico em um arquivo MP4 separado, pronto pra upload.
                    </p>

                    {!cutting && clips.length === 0 && (
                      <button
                        onClick={handleCut}
                        disabled={topics.length === 0}
                        className="w-full sm:w-auto px-5 py-3 bg-tint text-tint-foreground rounded-xl font-medium text-sm hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                      >
                        <Download className="w-4 h-4" />
                        Baixar Video e Cortar {topics.length} Clipes
                      </button>
                    )}

                    {cutting && (
                      <div className="space-y-3">
                        <div className="flex items-center gap-3">
                          <div className="w-5 h-5 border-2 border-tint/30 border-t-tint rounded-full animate-spin" />
                          <span className="text-sm">{cutProgress.status}</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-tint transition-all duration-300 rounded-full"
                            style={{ width: `${cutProgress.total > 0 ? (cutProgress.current / cutProgress.total) * 100 : 0}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {clips.length > 0 && !cutting && (
                      <div className="space-y-2">
                        <p className="text-sm text-success font-medium mb-2">
                          {clips.length} clipes prontos!
                        </p>
                        {clips.map(clip => (
                          <div key={clip.index} className="flex items-center justify-between bg-muted/50 rounded-lg px-4 py-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="text-xs font-mono bg-background px-2 py-0.5 rounded">#{clip.index}</span>
                              <span className="text-sm truncate">{clip.title}</span>
                              <span className="text-xs text-muted-foreground shrink-0">
                                {(clip.blob.size / 1024 / 1024).toFixed(1)} MB
                              </span>
                            </div>
                            <a
                              href={clip.url}
                              download={`clip_${String(clip.index).padStart(2, "0")}.mp4`}
                              className="text-xs text-tint hover:underline flex items-center gap-1 shrink-0 ml-3"
                            >
                              <Download className="w-3 h-3" /> Baixar
                            </a>
                          </div>
                        ))}
                        <button
                          onClick={() => { setClips([]); setCutProgress({ current: 0, total: 0, status: "" }); }}
                          className="text-xs text-muted-foreground hover:text-foreground mt-2"
                        >
                          Limpar e cortar novamente
                        </button>
                      </div>
                    )}
                  </div>
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
              <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-medium mb-1">{videoData.title}</p>
              <p className="text-xs text-muted-foreground mb-3">
                {videoData.duration > 0 ? `${Math.floor(videoData.duration / 60)}min` : ""}
                {videoFile ? " — Arquivo carregado!" : " — Link detectado. Para cortar, faca upload do MP4 abaixo."}
              </p>
              {!videoFile && (
                <p className="text-xs text-tint">
                  Arraste o arquivo MP4 do podcast na area de upload acima
                </p>
              )}
              {!apiKey && (
                <p className="text-xs text-muted-foreground mt-2">
                  Com chave Groq: IA detecta topicos, titulos e SEO automaticos
                </p>
              )}
              <button onClick={generateThumbnails} className="text-sm text-tint hover:underline mt-2 block mx-auto">Gerar thumbnail</button>
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
