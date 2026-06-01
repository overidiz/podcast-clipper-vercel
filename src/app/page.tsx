"use client";

import { useState, useCallback, useRef } from "react";
import {
  Scissors, Film, Clock, Image, Tags, Download,
  Sparkles, Play, Pencil, Check, Copy, Zap, Hash, FileText,
} from "lucide-react";
import { toast } from "sonner";
import { formatTime } from "@/lib/utils";
import { generateAllThumbnails } from "@/lib/thumbnail";
import { extractKeywords, generateTags, generateHashtags, formatForExport } from "@/lib/seo";

interface Topic {
  index: number;
  title: string;
  summary: string;
  start: number;
  end: number;
  duration: number;
}

interface ClipResult {
  topics: Topic[];
  seoDescription: string;
  hashtags: string[];
  tags: string[];
  suggestedTitles: string[];
}

type Tab = "topics" | "thumbs" | "export";

export default function Home() {
  const [url, setUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [language, setLanguage] = useState("pt");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [statusDetail, setStatusDetail] = useState("");
  const [result, setResult] = useState<ClipResult | null>(null);
  const [editedTopics, setEditedTopics] = useState<Topic[]>([]);
  const [thumbnails, setThumbnails] = useState<{ index: number; title: string; url: string }[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("topics");
  const [generatingThumbs, setGeneratingThumbs] = useState(false);
  const [cutScript, setCutScript] = useState("");
  const [localKeywords, setLocalKeywords] = useState<string[]>([]);
  const [videoId, setVideoId] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);

  // Fallback: local keyword-based topic detection (no API needed)
  const localAnalyze = useCallback((text: string, segments: { start: number; end: number; text: string }[]) => {
    const keywords = extractKeywords(text);
    setLocalKeywords(keywords);

    // Simple segmentation: group by paragraph size
    const topics: Topic[] = [];
    let currentText = "";
    let currentStart = segments[0]?.start || 0;
    let currentEnd = segments[0]?.end || 0;
    const MIN_DURATION = 45;

    for (const seg of segments) {
      currentText += " " + seg.text;
      currentEnd = seg.end;

      if (currentText.length > 500 || (seg.end - currentStart) > 180) {
        const words = currentText.split(/\s+/);
        const topWords = keywords.filter((k) =>
          currentText.toLowerCase().includes(k)
        ).slice(0, 5);

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

    // Last topic
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

    const tags = generateTags(keywords);
    const hashtags = generateHashtags(keywords);

    return {
      topics,
      seoDescription: `${topics.length} topicos sobre ${keywords.slice(0, 4).join(", ")}`,
      hashtags,
      tags,
      suggestedTitles: topics.map((t) => t.title).slice(0, 3),
    };
  }, []);

  const handleSubmit = async () => {
    if (!url) return;
    setLoading(true);
    setStatus("downloading");
    setStatusDetail("Baixando audio do YouTube...");
    setResult(null);
    setThumbnails([]);
    setCutScript("");

    try {
      // Download audio via API
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, language, apiKey: apiKey || undefined }),
      });

      const data = await res.json();

      if (data.error) {
        // Fallback: try local mode
        if (data.fallback && data.transcript) {
          setStatus("analyzing");
          setStatusDetail("Analisando topicos localmente...");
          const localResult = localAnalyze(data.transcript, data.segments);
          setResult(localResult);
          setEditedTopics(localResult.topics);
          setVideoId(data.videoId || "");
          if (localResult.topics.length > 0) {
            generateCutScript(localResult.topics, data.videoId || "");
          }
          setLoading(false);
          setStatus("completed");
          toast.success(`${localResult.topics.length} topicos detectados (modo local gratuito)!`);
          return;
        }
        toast.error(data.error);
        setLoading(false);
        return;
      }

      // Poll for completion
      if (data.jobId) {
        const poll = async () => {
          const statusRes = await fetch(`/api/jobs?jobId=${data.jobId}`);
          const job = await statusRes.json();

          if (job.status === "completed") {
            setResult(job.result);
            setEditedTopics(job.result.topics);
            setVideoId(job.result.videoId || "");
            if (job.result.topics?.length > 0) {
              generateCutScript(job.result.topics, job.result.videoId || "");
            }
            setLoading(false);
            setStatus("completed");
            toast.success(`${job.result.topics?.length || 0} topicos detectados!`);
          } else if (job.status === "error") {
            setLoading(false);
            setStatus("error");
            toast.error(job.result?.error || "Erro");
          } else {
            setStatus(job.status);
            setStatusDetail(job.status === "transcribing" ? "Transcrevendo com Whisper..." : "Analisando topicos...");
            setTimeout(poll, 3000);
          }
        };
        poll();
      }
    } catch (err) {
      setLoading(false);
      toast.error("Erro ao processar. Verifique sua conexao.");
    }
  };

  const generateCutScript = (topics: Topic[], vid: string) => {
    const lines = [
      "#!/bin/bash",
      "# Podcast Clipper - Script de Corte",
      `# Video: https://youtube.com/watch?v=${vid}`,
      "",
      `# Baixe o video antes de rodar este script:`,
      `# yt-dlp -f "best[height<=1080]" -o "${vid}.mp4" "https://youtube.com/watch?v=${vid}"`,
      "",
      `INPUT="${vid}.mp4"`,
      `mkdir -p output`,
      "",
    ];

    topics.forEach((t) => {
      const start = t.start.toFixed(1);
      const dur = (t.duration + 1).toFixed(1);
      const safe = t.title.replace(/[<>:"/\\|?*]/g, "").slice(0, 50);
      const num = String(t.index).padStart(2, "0");
      lines.push(
        `echo "Cortando: ${t.title}"`,
        `ffmpeg -y -ss ${start} -i "$INPUT" -t ${dur} \\`,
        `  -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k \\`,
        `  -movflags +faststart "output/${num}_${safe}.mp4"`,
        "",
      );
    });

    lines.push(`echo "Concluido! ${topics.length} cortes em output/"`);
    setCutScript(lines.join("\n"));
  };

  const generateThumbnails = async () => {
    if (!url) return;
    setGeneratingThumbs(true);
    try {
      const thumbs = await generateAllThumbnails(
        url,
        editedTopics.map((t) => ({ start: t.start, title: t.title })),
        { accentColor: "#eab308" }
      );
      setThumbnails(thumbs);
      setActiveTab("thumbs");
      toast.success(`${thumbs.length} thumbnails geradas!`);
    } catch (err) {
      toast.error("Erro ao gerar thumbnails. O video precisa estar disponivel.");
    }
    setGeneratingThumbs(false);
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

  const seoDescription = result?.seoDescription
    || `${editedTopics.length} cortes extraidos automaticamente do podcast. Assista os melhores momentos!`;

  return (
    <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 sm:py-10">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-tint/10 text-tint text-sm font-medium mb-4">
          <Zap className="w-4 h-4" />
          100% Gratuito — processamento local
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-3">
          Podcast Clipper
        </h1>
        <p className="text-muted-foreground text-lg max-w-lg mx-auto">
          Corte podcasts do YouTube com titulos, thumbnails e SEO automaticos.
          Pronto pra upar no YouTube Studio.
        </p>
      </div>

      {/* Input Card */}
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
                <>
                  <div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                  {status === "downloading" ? "Baixando..." : status === "transcribing" ? "Whisper..." : "Analisando..."}
                </>
              ) : (
                <>
                  <Scissors className="w-4 h-4" />
                  Processar
                </>
              )}
            </button>
          </div>

          {/* Groq API key (optional) */}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer hover:text-foreground transition-colors">
              Usar Groq API (Whisper + LLM gratuitos — mais preciso)
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
              Sem chave = modo local gratuito (menos preciso, mas funciona).{" "}
              <a href="https://console.groq.com" target="_blank" className="text-tint underline">Criar chave gratis</a>
            </p>
          </details>
        </div>

        {loading && statusDetail && (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <div className="w-3 h-3 border-2 border-tint/30 border-t-tint rounded-full animate-spin" />
            {statusDetail}
          </div>
        )}
      </div>

      {/* Results */}
      {editedTopics.length > 0 && (
        <div className="space-y-6">
          {/* Stats Bar */}
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground bg-card border rounded-xl px-4 py-3">
            <Clock className="w-4 h-4" />
            <span>{editedTopics.length} topicos</span>
            <span>•</span>
            <FileText className="w-4 h-4" />
            <span>SEO otimizado</span>
            <span>•</span>
            <Hash className="w-4 h-4" />
            <span>{result?.hashtags?.length || localKeywords.length} hashtags</span>
            <span>•</span>
            <Image className="w-4 h-4" />
            <span>{thumbnails.length > 0 ? `${thumbnails.length} thumbs` : "thumbs disponiveis"}</span>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-muted rounded-xl p-1">
            {([
              ["topics", "Topicos", Pencil],
              ["thumbs", "Thumbnails", Image],
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

          {/* Tab: Topics */}
          {activeTab === "topics" && (
            <div className="space-y-3">
              {editedTopics.map((topic) => (
                <div key={topic.index} className="bg-card border rounded-xl p-4 hover:border-tint/30 transition-colors group">
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

          {/* Tab: Thumbnails */}
          {activeTab === "thumbs" && (
            <div className="space-y-4">
              {thumbnails.length === 0 ? (
                <div className="text-center py-12 bg-card border rounded-2xl">
                  <Image className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <h3 className="font-medium mb-2">Thumbnails automaticas</h3>
                  <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                    Gere thumbnails profissionais com titulo sobreposto, prontas pro YouTube.
                    Extraidas diretamente do video nos momentos de cada topico.
                  </p>
                  <button
                    onClick={generateThumbnails}
                    disabled={generatingThumbs || !url}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-tint text-tint-foreground rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50"
                  >
                    {generatingThumbs ? (
                      <><div className="w-4 h-4 border-2 border-current/30 border-t-current rounded-full animate-spin" /> Gerando...</>
                    ) : (
                      <><Sparkles className="w-4 h-4" /> Gerar Thumbnails</>
                    )}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {thumbnails.map((thumb) => (
                    <div key={thumb.index} className="bg-card border rounded-xl overflow-hidden group">
                      <img
                        src={thumb.url}
                        alt={thumb.title}
                        className="w-full aspect-video object-cover"
                      />
                      <div className="p-3 flex items-center justify-between">
                        <span className="text-xs font-medium truncate">{thumb.title}</span>
                        <a
                          href={thumb.url}
                          download={`thumb_${thumb.index}.jpg`}
                          className="text-xs text-tint hover:underline flex items-center gap-1"
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

          {/* Tab: Export */}
          {activeTab === "export" && (
            <div className="space-y-4">
              {/* SEO Description */}
              <div className="bg-card border rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <Tags className="w-4 h-4" /> Descricao YouTube
                  </h3>
                  <button
                    onClick={() => copyToClipboard(seoDescription, "Descricao")}
                    className="text-xs text-tint hover:underline flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" /> Copiar
                  </button>
                </div>
                <p className="text-sm text-muted-foreground bg-muted/50 rounded-lg p-3">{seoDescription}</p>
              </div>

              {/* Hashtags & Tags */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-card border rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <Hash className="w-4 h-4" /> Hashtags
                    </h3>
                    <button
                      onClick={() => copyToClipboard((result?.hashtags || localKeywords.map((k) => `#${k}`)).join(" "), "Hashtags")}
                      className="text-xs text-tint hover:underline flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" /> Copiar
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(result?.hashtags || localKeywords.map((k) => `#${k}`)).slice(0, 15).map((tag) => (
                      <span key={tag} className="text-xs bg-tint/5 text-tint px-2 py-1 rounded-full">
                        {tag.startsWith("#") ? tag : `#${tag}`}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="bg-card border rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium flex items-center gap-2">
                      <Tags className="w-4 h-4" /> Tags
                    </h3>
                    <button
                      onClick={() => copyToClipboard((result?.tags || localKeywords).join(", "), "Tags")}
                      className="text-xs text-tint hover:underline flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" /> Copiar
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {(result?.tags || localKeywords).slice(0, 12).map((tag) => (
                      <span key={tag} className="text-xs bg-secondary text-secondary-foreground px-2 py-1 rounded-full">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Suggested Titles */}
              {result?.suggestedTitles && result.suggestedTitles.length > 0 && (
                <div className="bg-card border rounded-xl p-4">
                  <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                    <Sparkles className="w-4 h-4" /> Titulos sugeridos
                  </h3>
                  <div className="space-y-2">
                    {result.suggestedTitles.map((title, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm bg-muted/50 rounded-lg px-3 py-2">
                        <span className="text-xs text-muted-foreground">{i + 1}.</span>
                        <span className="flex-1">{title}</span>
                        <button
                          onClick={() => copyToClipboard(title, "Titulo")}
                          className="text-xs text-tint hover:underline"
                        >
                          Copiar
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Cut Script */}
              {cutScript && (
                <div className="bg-card border rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/50">
                    <span className="text-sm font-medium flex items-center gap-2">
                      <Download className="w-4 h-4" /> Script de Corte
                    </span>
                    <button
                      onClick={() => copyToClipboard(cutScript, "Script")}
                      className="text-xs text-tint hover:underline flex items-center gap-1"
                    >
                      <Copy className="w-3 h-3" /> Copiar
                    </button>
                  </div>
                  <pre className="p-4 text-xs font-mono text-muted-foreground overflow-x-auto max-h-64 overflow-y-auto">
                    {cutScript}
                  </pre>
                </div>
              )}

              {/* Metadata TXT */}
              <div className="bg-card border rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/50">
                  <span className="text-sm font-medium flex items-center gap-2">
                    <FileText className="w-4 h-4" /> Metadados YouTube (TXT)
                  </span>
                  <button
                    onClick={() => {
                      const txt = formatForExport(editedTopics.map((t) => ({
                        ...t,
                        hashtags: result?.hashtags,
                        tags: result?.tags,
                      })));
                      copyToClipboard(txt, "Metadados");
                    }}
                    className="text-xs text-tint hover:underline flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" /> Copiar
                  </button>
                </div>
                <pre className="p-4 text-xs font-mono text-muted-foreground overflow-x-auto max-h-48 overflow-y-auto">
                  {formatForExport(editedTopics.map((t) => ({
                    ...t,
                    hashtags: result?.hashtags,
                    tags: result?.tags,
                  })))}
                </pre>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!loading && editedTopics.length === 0 && (
        <div className="text-center py-16">
          <div className="w-24 h-24 mx-auto mb-6 rounded-3xl bg-muted flex items-center justify-center">
            <Scissors className="w-10 h-10 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold mb-3">Cole um podcast do YouTube</h2>
          <p className="text-sm text-muted-foreground max-w-lg mx-auto mb-2">
            <strong>100% gratuito.</strong> O app baixa o audio, transcreve, detecta topicos,
            gera titulos, thumbnails e palavras-chave de SEO.
          </p>
          <p className="text-xs text-muted-foreground">
            Com Groq API key = mais preciso (gratis em{" "}
            <a href="https://console.groq.com" className="text-tint underline" target="_blank">console.groq.com</a>)
            {" "}| Sem key = modo local gratuito
          </p>
        </div>
      )}

      {/* Hidden video for thumbnails */}
      <video ref={videoRef} className="hidden" crossOrigin="anonymous" />
    </main>
  );
}
