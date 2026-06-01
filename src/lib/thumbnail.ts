// Browser-based thumbnail generation using Canvas API
// Extracts a frame from video element and adds text overlay

export interface ThumbnailConfig {
  title: string;
  subtitle?: string;
  backgroundColor?: string;
  textColor?: string;
  accentColor?: string;
}

export async function generateThumbnail(
  videoElement: HTMLVideoElement,
  timeInSeconds: number,
  config: ThumbnailConfig
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return reject(new Error("Canvas not supported"));

    // YouTube thumbnail size
    canvas.width = 1280;
    canvas.height = 720;

    videoElement.currentTime = timeInSeconds;

    videoElement.onseeked = () => {
      try {
        // Draw video frame
        ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

        // Dark overlay gradient at bottom
        const gradient = ctx.createLinearGradient(0, canvas.height * 0.4, 0, canvas.height);
        gradient.addColorStop(0, "transparent");
        gradient.addColorStop(1, "rgba(0,0,0,0.85)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Accent line
        ctx.fillStyle = config.accentColor || "#eab308";
        ctx.fillRect(40, canvas.height - 220, 6, 60);

        // Title
        ctx.fillStyle = config.textColor || "#ffffff";
        ctx.font = "bold 48px 'Geist', 'Inter', system-ui, sans-serif";

        const words = config.title.split(" ");
        let line = "";
        let y = canvas.height - 180;
        const maxWidth = canvas.width - 100;

        for (const word of words) {
          const test = line + word + " ";
          if (ctx.measureText(test).width > maxWidth && line) {
            ctx.fillText(line.trim(), 60, y);
            line = word + " ";
            y += 56;
            if (y > canvas.height - 30) break;
          } else {
            line = test;
          }
        }
        if (line.trim()) ctx.fillText(line.trim(), 60, y);

        // Subtitle
        if (config.subtitle) {
          ctx.font = "24px 'Geist', 'Inter', system-ui, sans-serif";
          ctx.fillStyle = "rgba(255,255,255,0.7)";
          ctx.fillText(config.subtitle, 60, y + 40);
        }

        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("Failed to create blob"));
        }, "image/jpeg", 0.92);
      } catch (e) {
        reject(e);
      }
    };

    videoElement.onerror = () => reject(new Error("Video seek failed"));
  });
}

export async function generateAllThumbnails(
  videoUrl: string,
  topics: { start: number; title: string }[],
  config: Partial<ThumbnailConfig> = {}
): Promise<{ index: number; title: string; blob: Blob; url: string }[]> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.src = videoUrl;
  video.preload = "auto";
  video.muted = true;

  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Video load failed"));
  });

  const results = [];
  for (const topic of topics) {
    const blob = await generateThumbnail(video, topic.start + 2, {
      title: topic.title,
      ...config,
    });
    const url = URL.createObjectURL(blob);
    results.push({
      index: topics.indexOf(topic) + 1,
      title: topic.title,
      blob,
      url,
    });
  }

  video.remove();
  return results;
}
