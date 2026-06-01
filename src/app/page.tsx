"use client";

import { useState, useRef } from "react";
import {
  Scissors, Film, Clock, Image as ImageIcon, Tags, Download,
  Sparkles, Pencil, Copy, Zap, Hash, FileText, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { formatTime } from "@/lib/utils";
import { generateAllThumbnailsFromImage } from "@/lib/thumbnail";
import { extractKeywords, generateTags, generateHashtags, formatForExport } from "@/lib/seo";

interface Topic {
  index: number;
  title: string;
  summary: string;
  start: number;
  end: number;
  duration: number;
}

interface AppState {
  videoId: string;
  title: string;
  duration: number;
  thumbnail: string;
  videoUrl: string | null;
  topics: Topic[];
  seoDescription: string;
  hashtags: string[];
  tags: string[];
  suggestedTitles: string[];
  transcript: string;
  segments: { start: number; end: number; text: string }[];
  provider: string;
}

type Tab = "topics" | "thumbs" | "export";

export default function Home() {
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [language, setLanguage] = useState("pt");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [state, setState] = useState<AppState | null>(null);
  const [editedTopics, setEditedTopics] = useState<Topic[]>([]);
  const [thumbnails, setThumbnails] = useState<{ index: number; title: string; url: string }[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("topics");
  const [generatingThumbs, setGeneratingThumbs] = useState(false);
  const [cutScript, setCutScript] = useState("");

  const handleSubmit = async () => {
    if (!url) return;
    setLoading(true);
    setStatus("Analisando video...");
    setState(null);
    setThumbnails([]);
    setCutScript("");
    setEditedTopics([]);

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, language, apiKey: apiKey || undefined }),
      });

      const data = await res.json();

      if (data.error) {
        toast.error(data.error);
        setLoading(false);
        return;
      }

      // If Groq returned full analysis
      if (data.topics && data.topics.length > 0) {
        setState(data);
        setEditedTopics(data.topics);
        if (data.topics.length > 0) {
          generateCutScript(data.topics, data.videoId);
        }
        setLoading(false);
        setStatus("");
        toast.success(`${data.topics.length} topicos detectados via ${data.provider || "IA"}!`);
        return;
      }

      // Local mode: analyze transcript client-side if available
      if (data.transcript && data.segments) {
        const localResult = localAnalyze(data.transcript, data.segments);
        setState({ ...data, ...localResult });
        setEditedTopics(localResult.topics);
        if (localResult.topics.length > 0) {
          generateCutScript(localResult.topics, data.videoId);
        }
        setLoading(false);
        setStatus("");
        toast.success(`${localResult.topics.length} topicos detectados (modo local)!`);
        return;
      }

      // Just video info, no transcription
      setState(data);
      setLoading(false);
      setStatus("");
      toast.info("Video encontrado! Adicione uma chave Groq para transcricao com IA.");
    } catch (err) {
      setLoading(false);
      toast.error("Erro ao processar. Verifique sua conexao.");
    }
  };

  const localAnalyze = (text: string, segments: { start: number; end: number; text: string }[]) => {
    const keywords = extractKeywords(text);
    const topics: Topic[] = [];
    let currentText = "";
    let currentStart = segments[0]?.start || 0;
    let currentEnd = segments[0]?.end || 0;
    const MIN_DURATION = 45;

    for (const seg of segments) {
      currentText += " " + seg.text;
      currentEnd = seg.end;

      if (currentText.length > 500 || (seg.end - currentStart) > 180) {
        const topWords = keywords.filter((k) => currentText.toLowerCase().includes(k)).slice(0, 5);
        const title = topWords.length > 0
          ? topWords.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
          : `Momento ${topics.length + 1}`;

        if ((currentEnd - currentStart) >= MIN_DURATION) {
          topics.push({
            index: topics.length + 1,
            title: title.slice(0, 60),
            summary: currentText.slice(0, 200),
            start: currentStart,
            end: currentEnd,
            duration: currentEnd - currentStart,
          });
        }
        currentText = "";
        currentStart = seg.end;
      }
    }

    if (currentText.trim() && (currentEnd - currentStart) >= MIN_DURATION) {
      const topWords = keywords.filter((k) => currentText.toLowerCase().includes(k)).slice(0, 5);
      topics.push({
        index: topics.length + 1,
        title: (topWords.length > 0 ? topWords.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") : `Topico ${topics.length + 1}`).slice(0, 60),
        summary: currentText.slice(0, 200),
        start: currentStart,
        end: currentEnd,
        duration: currentEnd - currentStart,
      });
    }

    return {
      topics,
      seoDescription: `${topics.length} topicos sobre ${keywords.slice(0, 4).join(", ")}`,
      hashtags: generateHashtags(keywords),
      tags: generateTags(keywords),
      suggestedTitles: topics.map((t) => t.title).slice(0, 3),
      transcript: text,
      segments,
      provider: "local",
    };
  };

  const generateCutScript = (topics: Topic[], vid: string) => {
    const lines = [
      "#!/bin/bash",
      "# ==========================================",
      "# Podcast Clipper — Script de Corte de Video",
      `# Video: https://youtube.com/watch?v=${vid}`,
      "# ==========================================",
      "",
      "# 1. Baixe o video (1080p):",
      `yt-dlp -f "bestvideo[height<=1080]+bestaudio/best[height<=1080]" \\`,
      `  -o "${vid}.mp4" "https://youtube.com/watch?v=${vid}"`,
      "",
      "# 2. Corte os clips:",
      `INPUT="${vid}.mp4"`,
      "mkdir -p clips",
      "",
    ];

    topics.forEach((t) => {
      const start = t.start.toFixed(1);
      const dur = (t.duration + 1).toFixed(1);
      const safe = t.title.replace(/[<>:"/\\|?*]/g, "").slice(0, 50);
      const num = String(t.index).padStart(2, "0");
      lines.push(
        `echo "🎬 ${t.title}"`,
        `ffmpeg -y -ss ${start} -i "$INPUT" -t ${dur} \\`,
        `  -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k \\`,
        `  -movflags +faststart "clips/${num}_${safe}.mp4"`,
        "",
      );
    });

    lines.push(`echo ""`);
    lines.push(`echo "✅ ${topics.length} cortes prontos em clips/"`);
    lines.push(`echo ""`);
    lines.push(`echo "Titulos para YouTube Studio:"`);
    topics.forEach((t) => {
      lines.push(`echo "  ${t.index}. ${t.title}"`);
    });

    setCutScript(lines.join("\n"));
  };

  const generateThumbnails = async () => {
    if (!state?.thumbnail) return;
    setGeneratingThumbs(true);
    try {
      const thumbs = await generateAllThumbnailsFromImage(
        state.thumbnail,
        editedTopics.map((t) => ({ index: t.index, title: t.title })),
        { accentColor: "#eab308" }
      );
      setThumbnails(thumbs);
      setActiveTab("thumbs");
      toast.success(`${thumbs.length} thumbnails geradas!`);
    } catch {
      toast.error("Erro ao gerar thumbnails. Tentando metodo alternativo...");
      // Fallback: create text-only thumbnails
      const fallback = await createFallbackThumbnails(editedTopics);
      setThumbnails(fallback);
      setActiveTab("thumbs");
    }
    setGeneratingThumbs(false);
  };

  const createFallbackThumbnails = async (topics: Topic[]) => {
    const results = [];
    for (const topic of topics) {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext("2d")!;

      // Dark gradient bg
      const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      grad.addColorStop(0, "#0a0a2e");
      grad.addColorStop(1, "#1a0a2e");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Accent bar
      ctx.fillStyle = "#eab308";
      ctx.fillRect(60, canvas.height / 2 - 40, 6, 64);

      // Title
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 44px 'Geist', 'Inter', sans-serif";
      const words = topic.title.split(" ");
      let line = "";
      let y = canvas.height / 2 - 10;
      for (const word of words) {
        const test = line + word + " ";
        if (ctx.measureText(test).width > 1100 && line) {
          ctx.fillText(line.trim(), 80, y);
          line = word + " ";
          y += 54;
        } else {
          line = test;
        }
      }
      if (line.trim()) ctx.fillText(line.trim(), 80, y);

      const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/jpeg", 0.9));
      const url = URL.createObjectURL(blob);
      results.push({ index: topic.index, title: topic.title, url });
    }
    return results;
  };

  const updateTopic = (index: number, field: keyof Topic, value: string | number) => {
    setEditedTopics((prev) =>
      prev.map((t) => (t.index === index ? { ...t, [field]: value } : t))
    );
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado!`);
  };

  const hasTopics = editedTopics.length > 0;

  return (
    <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 sm:py-10">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-tint/10 text-tint text-sm font-medium mb-4">
          <Zap className="w-4 h-4" />
          Gratuito — YouTube nativo + Groq IA
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-3">
          Podcast Clipper
        </h1>
        <p className="text-muted-foreground text-lg max-w-lg mx-auto">
          Cortes de video com titulos, thumbnails e SEO automaticos.
          Tudo pronto pra upar no YouTube Studio.
        </p>
      </div>

      {/* Input */}
      <div className="bg-card border rounded-2xl p-5 mb-8">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <Film className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <input
                type="text"
                placeholder="https://www.youtube.com/watch?v=..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={loading}
                className="w-full h-12 pl-10 pr-4 bg-background border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />
            </div>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={loading}
              className="h-12 px-3 bg-background border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="pt">Portugues</option>
              <option value="en">English</option>
              <option value="es">Espanol</option>
              <option value="auto">Auto</option>
            </select>
            <button
              onClick={handleSubmit}
              disabled={loading || !url}
              className="h-12 px-6 bg-tint text-tint-foreground rounded-xl font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-2 shrink-0"
            >
              {loading ? (
                <><div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />{status}</>
              ) : (
                <><Scissors className="w-4 h-4" />Processar</>
              )}
            </button>
          </div>

          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground transition-colors">
              Usar Groq API (Whisper + IA gratis — titulos e SEO melhores)
            </summary>
            <div className="mt-2 flex gap-2">
              <input
                type="password"
                placeholder="Cole sua Groq API Key (gratis em console.groq.com)"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={loading}
                className="flex-1 h-9 px-3 bg-background border rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 font-mono"
              />
            </div>
            <p className="mt-1">
              <a href="https://console.groq.com" target="_blank" className="text-tint underline">Criar chave gratis no Groq</a> — sem chave o app funciona com metadados basicos.
            </p>
          </details>
        </div>
      </div>

      {/* Results: Video info (no transcription yet) */}
      {state && !hasTopics && (
        <div className="bg-card border rounded-2xl p-8 text-center">
          <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-warning" />
          <h3 className="text-lg font-medium mb-2">Video encontrado!</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            <strong>{state.title}</strong> — {Math.floor(state.duration / 60)}min
          </p>
          <p className="text-sm text-muted-foreground mb-2">
            Para transcricao com IA e deteccao de topicos, adicione uma chave Groq gratuita.
          </p>
          <button
            onClick={() => document.querySelector("details")?.setAttribute("open", "")}
            className="text-sm text-tint hover:underline"
          >
            Adicionar chave Groq &rarr;
          </button>
        </div>
      )}

      {/* Results: Has topics */}
      {hasTopics && (
        <div className="space-y-6">
          {/* Stats Bar */}
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground bg-card border rounded-xl px-4 py-3">
            <Clock className="w-4 h-4" />
            <span>{editedTopics.length} topicos</span>
            <span>•</span>
            <Hash className="w-4 h-4" />
            <span>{state?.hashtags?.length || 0} hashtags</span>
            <span>•</span>
            <Tags className="w-4 h-4" />
            <span>{state?.tags?.length || 0} tags SEO</span>
            <span>•</span>
            <ImageIcon className="w-4 h-4" />
            <span>{thumbnails.length > 0 ? `${thumbnails.length} thumbs` : "thumbs"}</span>
            {state?.provider && (
              <>
                <span>•</span>
                <Sparkles className="w-4 h-4" />
                <span className="text-tint">{state.provider === "groq" ? "Groq IA" : "Local"}</span>
              </>
            )}
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-muted rounded-xl p-1">
            {([
              ["topics", "Topicos", Pencil],
              ["thumbs", "Thumbnails", ImageIcon],
              ["export", "Exportar", Download],
            ] as const).map(([tab, label, Icon]) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {/* Topics Tab */}
          {activeTab === "topics" && (
            <div className="space-y-3">
              {editedTopics.map((topic) => (
                <div key={topic.index} className="bg-card border rounded-xl p-4 hover:border-tint/30 transition-colors">
                  <div className="flex items-start gap-3">
                    <span className="text-xs font-mono bg-tint/10 text-tint px-2 py-1 rounded mt-1 shrink-0">
                      {String(topic.index).padStart(2, "0")}
                    </span>
                    <div className="flex-1 min-w-0">
                      <input
                        type="text"
                        value={topic.title}
                        onChange={(e) => updateTopic(topic.index, "title", e.target.value)}
                        className="w-full bg-transparent font-semibold text-sm focus:outline-none focus:ring-1 focus:ring-ring rounded px-1 -mx-1"
                      />
                      <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
                        <span className="bg-muted px-2 py-0.5 rounded font-mono">
                          {formatTime(topic.start)} → {formatTime(topic.end)}
                        </span>
                        <span>{Math.floor(topic.duration)}s</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{topic.summary}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Thumbnails Tab */}
          {activeTab === "thumbs" && (
            <div className="space-y-4">
              {thumbnails.length === 0 ? (
                <div className="text-center py-12 bg-card border rounded-2xl">
                  <ImageIcon className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="font-medium mb-2">Thumbnails para YouTube</h3>
                  <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                    Geradas automaticamente com titulo sobreposto no estilo YouTube.
                    Tamanho 1280x720, prontas pra upload.
                  </p>
                  <button
                    onClick={generateThumbnails}
                    disabled={generatingThumbs || !state?.thumbnail}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-tint text-tint-foreground rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    {generatingThumbs ? (
                      <><div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" /> Gerando...</>
                    ) : (
                      <><Sparkles className="w-4 h-4" /> Gerar {editedTopics.length} Thumbnails</>
                    )}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {thumbnails.map((thumb) => (
                    <div key={thumb.index} className="bg-card border rounded-xl overflow-hidden group">
                      <img src={thumb.url} alt={thumb.title} className="w-full aspect-video object-cover" />
                      <div className="p-3 flex items-center justify-between">
                        <span className="text-xs font-medium truncate flex-1 mr-2">{thumb.title}</span>
                        <a
                          href={thumb.url}
                          download={`thumb_${String(thumb.index).padStart(2, "0")}.jpg`}
                          className="text-xs text-tint hover:underline flex items-center gap-1 shrink-0"
                        >
                          <Download className="w-3 h-3" /> Baixar
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Export Tab */}
          {activeTab === "export" && (
            <div className="space-y-4">
              {/* SEO */}
              <div className="bg-card border rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium flex items-center gap-2"><Tags className="w-4 h-4" /> Descricao YouTube</h3>
                  <button onClick={() => copyToClipboard(state?.seoDescription || "", "Descricao")} className="text-xs text-tint hover:underline flex items-center gap-1"><Copy className="w-3 h-3" /> Copiar</button>
                </div>
                <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">{state?.seoDescription || "Descricao nao disponivel"}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-card border rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium flex items-center gap-2"><Hash className="w-4 h-4" /> Hashtags</h3>
                    <button onClick={() => copyToClipboard((state?.hashtags || []).join(" "), "Hashtags")} className="text-xs text-tint hover:underline flex items-center gap-1"><Copy className="w-3 h-3" /> Copiar</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(state?.hashtags || []).slice(0, 15).map((tag) => (
                      <span key={tag} className="text-xs bg-tint/5 text-tint px-2 py-1 rounded-full">{tag.startsWith("#") ? tag : `#${tag}`}</span>
                    ))}
                  </div>
                </div>
                <div className="bg-card border rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium flex items-center gap-2"><Tags className="w-4 h-4" /> Tags YouTube</h3>
                    <button onClick={() => copyToClipboard((state?.tags || []).join(", "), "Tags")} className="text-xs text-tint hover:underline flex items-center gap-1"><Copy className="w-3 h-3" /> Copiar</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(state?.tags || []).slice(0, 12).map((tag) => (
                      <span key={tag} className="text-xs bg-secondary text-secondary-foreground px-2 py-1 rounded-full">{tag}</span>
                    ))}
                  </div>
                </div>
              </div>

              {(state?.suggestedTitles?.length ?? 0) > 0 && (
                <div className="bg-card border rounded-xl p-4">
                  <h3 className="text-sm font-medium mb-3 flex items-center gap-2"><Sparkles className="w-4 h-4" /> Titulos sugeridos</h3>
                  <div className="space-y-2">
                    {state!.suggestedTitles!.map((title, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm bg-muted/50 rounded-lg px-3 py-2">
                        <span className="text-xs text-muted-foreground">{i + 1}.</span>
                        <span className="flex-1">{title}</span>
                        <button onClick={() => copyToClipboard(title, "Titulo")} className="text-xs text-tint hover:underline">Copiar</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {cutScript && (
                <div className="bg-card border rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/50">
                    <span className="text-sm font-medium flex items-center gap-2"><Download className="w-4 h-4" /> Script de Corte (bash)</span>
                    <button onClick={() => copyToClipboard(cutScript, "Script")} className="text-xs text-tint hover:underline flex items-center gap-1"><Copy className="w-3 h-3" /> Copiar</button>
                  </div>
                  <pre className="p-4 text-xs font-mono text-muted-foreground overflow-x-auto max-h-80 overflow-y-auto">{cutScript}</pre>
                  <div className="px-4 py-3 bg-muted/30 border-t">
                    <p className="text-xs text-muted-foreground">
                      Salve como <code className="bg-muted px-1 py-0.5 rounded">cortar.sh</code> e execute no terminal.
                      Requer <strong>ffmpeg</strong> e <strong>yt-dlp</strong> instalados.
                    </p>
                  </div>
                </div>
              )}

              <div className="bg-card border rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/50">
                  <span className="text-sm font-medium flex items-center gap-2"><FileText className="w-4 h-4" /> Metadados YouTube (TXT)</span>
                  <button onClick={() => {
                    copyToClipboard(formatForExport(editedTopics.map((t) => ({ ...t, hashtags: state?.hashtags, tags: state?.tags }))), "Metadados");
                  }} className="text-xs text-tint hover:underline flex items-center gap-1"><Copy className="w-3 h-3" /> Copiar</button>
                </div>
                <pre className="p-4 text-xs font-mono text-muted-foreground overflow-x-auto max-h-48 overflow-y-auto">
                  {formatForExport(editedTopics.map((t) => ({ ...t, hashtags: state?.hashtags, tags: state?.tags })))}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!loading && !state && (
        <div className="text-center py-16">
          <div className="w-24 h-24 mx-auto mb-6 rounded-3xl bg-muted flex items-center justify-center">
            <Scissors className="w-10 h-10 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold mb-3">Cole um podcast do YouTube</h2>
          <p className="text-sm text-muted-foreground max-w-lg mx-auto mb-2">
            <strong>100% gratuito.</strong> Extrai audio/video do YouTube, transcreve com IA,
            detecta topicos, gera titulos, thumbnails e SEO.
          </p>
          <p className="text-xs text-muted-foreground">
            Com Groq API = mais preciso | Sem key = metadados basicos
          </p>
        </div>
      )}
    </main>
  );
}
