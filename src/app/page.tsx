"use client";

import { useState, useCallback } from "react";
import { Scissors, Film, Clock, FileText, Download, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { formatTime } from "@/lib/utils";

interface Topic {
  index: number;
  title: string;
  summary: string;
  start: number;
  end: number;
  duration: number;
}

interface JobResult {
  videoId: string;
  duration: number;
  topics: Topic[];
  fullText: string;
}

export default function Home() {
  const [url, setUrl] = useState("");
  const [language, setLanguage] = useState("pt");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [jobId, setJobId] = useState("");
  const [result, setResult] = useState<JobResult | null>(null);
  const [editedTopics, setEditedTopics] = useState<Topic[]>([]);
  const [cutScript, setCutScript] = useState("");

  const pollJob = useCallback(async (id: string) => {
    const res = await fetch(`/api/jobs?jobId=${id}`);
    const job = await res.json();

    if (job.status === "completed") {
      setLoading(false);
      setStatus("completed");
      setResult(job.result);
      setEditedTopics(job.result.topics);
      generateCutScript(job.result);
      toast.success(`${job.result.topics.length} topicos encontrados!`);
    } else if (job.status === "error") {
      setLoading(false);
      setStatus("error");
      toast.error(job.result?.error || "Erro na transcricao");
    } else {
      setStatus(job.status);
      setTimeout(() => pollJob(id), 3000);
    }
  }, []);

  const handleSubmit = async () => {
    if (!url) return;
    setLoading(true);
    setStatus("starting");
    setResult(null);
    setCutScript("");

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, language }),
      });

      const data = await res.json();
      if (data.error) {
        toast.error(data.error);
        setLoading(false);
        return;
      }

      setJobId(data.jobId);
      setStatus("processing");
      pollJob(data.jobId);
    } catch (err) {
      toast.error("Erro ao processar podcast");
      setLoading(false);
    }
  };

  const generateCutScript = (r: JobResult) => {
    const lines = [
      "# Script de corte - Podcast Clipper",
      "# Execute este script localmente para gerar os cortes em video",
      "# Requer: ffmpeg e o video original baixado",
      `# Video ID: ${r.videoId}`,
      "",
      `# Baixe o video primeiro:`,
      `# yt-dlp -f "best[height<=1080]" -o "${r.videoId}.mp4" "https://youtube.com/watch?v=${r.videoId}"`,
      "",
      `INPUT="${r.videoId}.mp4"`,
      `mkdir -p output`,
      "",
    ];

    r.topics.forEach((t, i) => {
      const start = t.start.toFixed(1);
      const dur = (t.duration + 1).toFixed(1);
      const safeName = t.title.replace(/[^a-zA-Z0-9\u00C0-\u024F\s-]/g, "").slice(0, 40);
      const num = String(i + 1).padStart(2, "0");
      lines.push(
        `# ${t.title}`,
        `# ${t.summary.slice(0, 100)}`,
        `ffmpeg -y -ss ${start} -i "$INPUT" -t ${dur} -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k "output/${num}_${safeName}.mp4"`,
        "",
      );
    });

    setCutScript(lines.join("\n"));
  };

  const updateTopic = (index: number, field: keyof Topic, value: string | number) => {
    setEditedTopics((prev) =>
      prev.map((t) => (t.index === index ? { ...t, [field]: value } : t))
    );
  };

  return (
    <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8 sm:py-12">
      {/* Header */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-tint/10 text-tint text-sm font-medium mb-4">
          <Sparkles className="w-4 h-4" />
          Powered by AssemblyAI
        </div>
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mb-3">
          Podcast Clipper
        </h1>
        <p className="text-muted-foreground text-lg max-w-md mx-auto">
          Cole um podcast do YouTube e receba cortes com titulos automaticos, prontos pra upload.
        </p>
      </div>

      {/* Input */}
      <div className="bg-card border rounded-2xl p-6 mb-8">
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
            className="h-12 px-3 bg-background border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            <option value="pt">Portugues</option>
            <option value="en">English</option>
            <option value="es">Espanol</option>
            <option value="auto">Auto-detectar</option>
          </select>
          <button
            onClick={handleSubmit}
            disabled={loading || !url}
            className="h-12 px-6 bg-primary text-primary-foreground rounded-xl font-medium text-sm hover:opacity-90 disabled:opacity-50 transition-opacity flex items-center gap-2 shrink-0"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                {status === "downloading" ? "Baixando..." : status === "transcribing" ? "Transcrevendo..." : "Processando..."}
              </>
            ) : (
              <>
                <Scissors className="w-4 h-4" />
                Processar Podcast
              </>
            )}
          </button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <div className="space-y-6">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Clock className="w-4 h-4" />
            Duracao total: {Math.floor(result.duration / 60)}min
            <span className="mx-1">•</span>
            <FileText className="w-4 h-4" />
            {result.topics.length} topicos detectados
          </div>

          {/* Topics */}
          <div className="space-y-3">
            {editedTopics.map((topic) => (
              <div
                key={topic.index}
                className="bg-card border rounded-xl p-4 hover:border-tint/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-4 mb-2">
                  <div className="flex-1">
                    <input
                      type="text"
                      value={topic.title}
                      onChange={(e) => updateTopic(topic.index, "title", e.target.value)}
                      className="w-full bg-transparent font-semibold text-sm focus:outline-none focus:ring-1 focus:ring-ring rounded px-1 -mx-1"
                    />
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <span className="bg-muted px-2 py-0.5 rounded font-mono">
                        {formatTime(topic.start)} → {formatTime(topic.end)}
                      </span>
                      <span>{Math.floor(topic.duration)}s</span>
                    </div>
                  </div>
                  <span className="text-xs font-mono bg-tint/10 text-tint px-2 py-0.5 rounded shrink-0">
                    #{topic.index}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {topic.summary}
                </p>
              </div>
            ))}
          </div>

          {/* Cut Script */}
          {cutScript && (
            <div className="bg-card border rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between px-6 py-3 border-b bg-muted/50">
                <span className="text-sm font-medium flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  Script de corte local
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(cutScript);
                    toast.success("Script copiado!");
                  }}
                  className="text-xs text-tint hover:underline"
                >
                  Copiar script
                </button>
              </div>
              <pre className="p-6 text-xs font-mono text-muted-foreground overflow-x-auto max-h-96 overflow-y-auto whitespace-pre">
                {cutScript}
              </pre>
              <div className="px-6 py-3 bg-muted/30 border-t">
                <p className="text-xs text-muted-foreground">
                  Salve como <code className="bg-muted px-1 py-0.5 rounded">cortar.sh</code> e execute localmente.
                  Requer ffmpeg e yt-dlp instalados.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && (
        <div className="text-center py-16">
          <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-muted flex items-center justify-center">
            <Scissors className="w-8 h-8 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-medium mb-2">Nenhum podcast ainda</h2>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Cole a URL de um video do YouTube acima. O app baixa o audio, transcreve com AssemblyAI, detecta topicos automaticamente e gera um script de corte.
          </p>
        </div>
      )}
    </main>
  );
}
