import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

let ffmpegInstance: FFmpeg | null = null;

export async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpegInstance?.loaded) return ffmpegInstance;

  const ffmpeg = new FFmpeg();

  ffmpeg.on("log", ({ message }) => {
    // Too verbose, uncomment for debug:
    // console.log(message);
  });

  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });

  ffmpegInstance = ffmpeg;
  return ffmpeg;
}

export interface ClipJob {
  index: number;
  title: string;
  start: number;
  end: number;
}

export async function downloadVideoChunk(
  videoUrl: string,
  start: number,
  duration: number,
  onProgress?: (pct: number) => void
): Promise<Uint8Array> {
  // Use yt-dlp range download or direct fetch with range
  // For now, download the full segment via a CORS proxy approach
  // Actually, let's just fetch the full video and cache it

  // We'll handle this in the caller
  throw new Error("Use downloadFullVideo instead");
}

export async function cutVideo(
  videoBuffer: Uint8Array,
  jobs: ClipJob[],
  onProgress?: (current: number, total: number, status: string) => void
): Promise<{ index: number; title: string; blob: Blob }[]> {
  const ffmpeg = await getFFmpeg();

  // Write input file
  await ffmpeg.writeFile("input.mp4", videoBuffer);
  onProgress?.(0, jobs.length, "Video carregado. Iniciando cortes...");

  const results: { index: number; title: string; blob: Blob }[] = [];

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const outputName = `clip_${String(job.index).padStart(2, "0")}.mp4`;
    const startTime = job.start.toFixed(1);
    const duration = (job.end - job.start + 1).toFixed(1);

    onProgress?.(i + 1, jobs.length, `Cortando: ${job.title.slice(0, 40)}...`);

    // Use stream copy for audio + re-encode video for fast seeking
    await ffmpeg.exec([
      "-ss", startTime,
      "-i", "input.mp4",
      "-t", duration,
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "28",
      "-c:a", "aac",
      "-b:a", "96k",
      "-movflags", "+faststart",
      outputName,
    ]);

    const raw = await ffmpeg.readFile(outputName);
    const buf = new Uint8Array(raw as Uint8Array);
    const blob = new Blob([buf], { type: "video/mp4" });

    results.push({ index: job.index, title: job.title, blob });

    // Clean up output file
    await ffmpeg.deleteFile(outputName);
  }

  // Clean up input
  await ffmpeg.deleteFile("input.mp4");

  return results;
}

export async function downloadFullVideo(
  videoUrl: string,
  onProgress?: (pct: number) => void
): Promise<Uint8Array> {
  onProgress?.(0);

  const response = await fetch(videoUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status}: Falha ao baixar video`);

  const contentLength = response.headers.get("content-length");
  const total = contentLength ? parseInt(contentLength, 10) : 0;

  if (total > 500 * 1024 * 1024) {
    throw new Error(
      `Video muito grande (${(total / 1024 / 1024).toFixed(0)}MB). Maximo recomendado: 500MB.`
    );
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("Stream nao disponivel");

  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0) {
      onProgress?.(Math.round((received / total) * 100));
    }
  }

  // Combine chunks
  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }

  onProgress?.(100);
  return buffer;
}
