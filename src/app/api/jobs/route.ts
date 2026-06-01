import { NextRequest, NextResponse } from "next/server";
import {
  uploadAudio,
  submitTranscription,
  pollTranscript,
  chaptersToTopics,
} from "@/lib/assemblyai";
import { getVideoId } from "@/lib/utils";

// In-memory job store (replace with Supabase in production)
const jobs = new Map<string, { status: string; result?: unknown }>();

export async function POST(req: NextRequest) {
  try {
    const { url, language = "pt" } = await req.json();

    if (!url) {
      return NextResponse.json({ error: "URL obrigatoria" }, { status: 400 });
    }

    const videoId = getVideoId(url);
    const jobId = `job_${videoId}_${Date.now()}`;
    jobs.set(jobId, { status: "downloading" });

    // Download audio using yt-dlp as a child process
    const { execSync } = await import("child_process");
    const { mkdtempSync } = await import("fs");
    const { join } = await import("path");
    const { tmpdir } = await import("os");

    const tmpDir = mkdtempSync(join(tmpdir(), "pclip-"));
    const audioPath = join(tmpDir, `${videoId}.mp3`);

    try {
      execSync(
        `yt-dlp -f "bestaudio[ext=m4a]/bestaudio" -o "${audioPath}" --extract-audio --audio-format mp3 --audio-quality 128K "${url}"`,
        { timeout: 120_000, stdio: "pipe" }
      );
    } catch {
      // Fallback: try best quality
      execSync(
        `yt-dlp -f "bestaudio" -o "${audioPath}" --extract-audio --audio-format mp3 --audio-quality 128K "${url}"`,
        { timeout: 120_000, stdio: "pipe" }
      );
    }

    jobs.set(jobId, { status: "transcribing" });

    // Read audio file
    const { readFileSync, unlinkSync, rmdirSync } = await import("fs");
    const audioBuffer = readFileSync(audioPath);

    // Clean up temp files
    try { unlinkSync(audioPath); rmdirSync(tmpDir); } catch {}

    // Upload to AssemblyAI
    const audioUrl = await uploadAudio(audioBuffer);

    // Submit transcription with auto chapters
    const { id: transcriptId } = await submitTranscription(audioUrl, language);

    jobs.set(jobId, { status: "processing", result: { transcriptId } });

    // Start polling in background
    pollTranscript(transcriptId)
      .then((result) => {
        if (result.status === "completed") {
          const topics = chaptersToTopics(result.chapters || []);
          jobs.set(jobId, {
            status: "completed",
            result: {
              transcriptId,
              videoId,
              duration: result.audio_duration,
              topics,
              fullText: result.text,
            },
          });
        } else {
          jobs.set(jobId, {
            status: "error",
            result: { error: result.error || "Transcricao falhou" },
          });
        }
      })
      .catch((err) => {
        jobs.set(jobId, {
          status: "error",
          result: { error: String(err) },
        });
      });

    return NextResponse.json({
      jobId,
      transcriptId,
      status: "processing",
      message: "Audio enviado. A transcricao esta em andamento.",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Erro interno" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) {
    return NextResponse.json({ error: "jobId obrigatorio" }, { status: 400 });
  }

  const job = jobs.get(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job nao encontrado" }, { status: 404 });
  }

  return NextResponse.json(job);
}
