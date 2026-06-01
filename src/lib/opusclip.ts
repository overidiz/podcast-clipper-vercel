// OpusClip API client
// https://help.opus.pro/api-reference/overview
// Pro plan required: https://clip.opus.pro/dashboard

const OPUS_API = "https://api.opus.pro/api";

interface OpusClipResult {
  id: string;
  status: string;
  clips: {
    id: string;
    title: string;
    duration: number;
    thumbnailUrl: string;
    videoUrl: string;
    startTime: number;
    endTime: number;
  }[];
}

export async function createOpusProject(
  videoUrl: string,
  apiKey: string,
  options: {
    title?: string;
    language?: string;
    clipDurations?: [number, number]; // [min, max] in seconds
    topicKeywords?: string[];
    genre?: string;
  } = {}
): Promise<{ projectId: string }> {
  const body: Record<string, unknown> = {
    videoUrl,
    uploadedVideoAttr: {
      title: options.title || "Podcast Clip",
    },
    curationPref: {
      model: "ClipBasic",
      clipDurations: [options.clipDurations || [30, 180]],
      genre: options.genre || "Auto",
    },
    importPreference: {
      sourceLang: options.language || "pt",
    },
  };

  if (options.topicKeywords?.length) {
    (body.curationPref as Record<string, unknown>).topicKeywords = options.topicKeywords;
  }

  const res = await fetch(`${OPUS_API}/clip-projects`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpusClip API error: ${err}`);
  }

  const data = await res.json();
  return { projectId: data.id || data.projectId };
}

export async function getOpusProject(
  projectId: string,
  apiKey: string
): Promise<OpusClipResult> {
  const res = await fetch(`${OPUS_API}/clip-projects/${projectId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpusClip API error: ${err}`);
  }

  const data = await res.json();

  return {
    id: data.id,
    status: data.status || "processing",
    clips: (data.clips || []).map((c: Record<string, unknown>) => ({
      id: c.id,
      title: (c.title as string) || "Clip",
      duration: (c.duration as number) || 0,
      thumbnailUrl: (c.thumbnailUrl as string) || "",
      videoUrl: (c.videoUrl as string) || (c.downloadUrl as string) || "",
      startTime: (c.startTime as number) || 0,
      endTime: (c.endTime as number) || 0,
    })),
  };
}

export async function pollOpusProject(
  projectId: string,
  apiKey: string,
  maxWaitMs: number = 600_000
): Promise<OpusClipResult> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const result = await getOpusProject(projectId, apiKey);
    if (result.status === "completed" || result.status === "failed") {
      return result;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("OpusClip excedeu o tempo limite");
}
