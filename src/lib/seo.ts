// SEO keyword extraction and YouTube metadata generation

interface SEOData {
  title: string;
  description: string;
  tags: string[];
  hashtags: string[];
}

const FILLER_PT = new Set([
  "que", "pra", "pro", "por", "com", "sem", "mas", "mais", "muito", "bem",
  "assim", "entao", "então", "aí", "ai", "lá", "la", "aqui", "é", "foi",
  "ser", "vai", "tem", "ter", "fazer", "faz", "tipo", "coisa", "gente",
  "pessoa", "pessoas", "sempre", "nunca", "tudo", "nada", "porque",
  "também", "tambem", "sobre", "quando", "onde", "como", "qual", "cada",
  "todo", "todos", "umas", "uns", "uma", "um", "o", "a", "os", "as",
  "de", "da", "do", "das", "dos", "em", "no", "na", "nos", "nas",
  "ao", "aos", "à", "às", "se", "eu", "você", "voce", "ele", "ela",
  "nós", "nos", "eles", "elas", "me", "te", "lhe", "meu", "minha",
  "seu", "sua", "está", "esta", "estao", "estão", "são", "sao", "ha",
  "há", "mim", "ti", "si", "nosso", "nossa", "aí", "né", "hein",
]);

export function extractKeywords(text: string, topN: number = 15): string[] {
  // Normalize and tokenize
  const words = text
    .toLowerCase()
    .replace(/[^a-zÀ-ÿ0-9\s-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !FILLER_PT.has(w));

  // Count frequency
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) || 0) + 1);
  }

  // Sort by frequency
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([w]) => w);
}

export function generateTags(keywords: string[]): string[] {
  return keywords.map((k) => k.charAt(0).toUpperCase() + k.slice(1)).slice(0, 10);
}

export function generateHashtags(keywords: string[]): string[] {
  return keywords.slice(0, 15).map((k) => `#${k.replace(/\s+/g, "")}`);
}

export function generateDescription(
  title: string,
  keywords: string[],
  summary: string = ""
): string {
  const kw = keywords.slice(0, 5).join(", ");

  return [
    `${title} - ${summary ? summary.slice(0, 150) + "..." : `Confira este trecho sobre ${kw}!`}`,
    "",
    `📌 TOPICOS ABORDADOS:`,
    ...keywords.slice(0, 6).map((k) => `  • ${k.charAt(0).toUpperCase() + k.slice(1)}`),
    "",
    `🔔 Se inscreva no canal e ative o sininho!`,
    `💬 Deixe seu like e comente sua opiniao!`,
    "",
    `#shorts #podcast #cortes ${keywords.slice(0, 8).map((k) => `#${k.replace(/\s+/g, "")}`).join(" ")}`,
  ].join("\n");
}

export function buildYouTubeDescription(seo: SEOData): string {
  return [
    `📺 ${seo.title}`,
    "",
    seo.description,
    "",
    `🏷️ ${seo.hashtags.join(" ")}`,
  ].join("\n");
}

export function formatForExport(topics: {
  index: number;
  title: string;
  summary: string;
  start: number;
  end: number;
  hashtags?: string[];
  tags?: string[];
}[]): string {
  const lines = [
    "═══════════════════════════════════════════════",
    "  PODCAST CLIPPER — METADADOS PARA YOUTUBE",
    "═══════════════════════════════════════════════",
    "",
  ];

  for (const t of topics) {
    const mStart = Math.floor(t.start / 60);
    const sStart = Math.floor(t.start % 60);
    const mEnd = Math.floor(t.end / 60);
    const sEnd = Math.floor(t.end % 60);

    lines.push(
      `──► CORTE ${t.index} ◄──`,
      `  Título: ${t.title}`,
      `  Início: ${mStart}:${sStart.toString().padStart(2, "0")}`,
      `  Fim:    ${mEnd}:${sEnd.toString().padStart(2, "0")}`,
      `  Descrição: ${t.summary}`,
    );
    if (t.tags?.length) lines.push(`  Tags: ${t.tags.join(", ")}`);
    if (t.hashtags?.length) lines.push(`  Hashtags: ${t.hashtags.join(" ")}`);
    lines.push("");
  }

  return lines.join("\n");
}
