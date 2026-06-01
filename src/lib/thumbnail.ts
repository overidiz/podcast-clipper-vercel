// Thumbnail generation using Canvas API
// Works without CORS by proxying images or using pre-fetched base64

export interface ThumbnailConfig {
  title: string;
  subtitle?: string;
  accentColor?: string;
  textColor?: string;
}

const CORS_PROXY = "https://corsproxy.io/?";

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    // Try direct first, then CORS proxy
    img.onload = () => resolve(img);
    img.onerror = () => {
      // Try with CORS proxy
      const proxyImg = new Image();
      proxyImg.crossOrigin = "anonymous";
      proxyImg.onload = () => resolve(proxyImg);
      proxyImg.onerror = () => reject(new Error("Failed to load thumbnail image"));
      proxyImg.src = CORS_PROXY + encodeURIComponent(url);
    };
    img.src = url;
  });
}

export async function generateThumbnailFromImage(
  imageUrl: string,
  config: ThumbnailConfig
): Promise<Blob> {
  const img = await loadImage(imageUrl);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");

  // YouTube 16:9
  canvas.width = 1280;
  canvas.height = 720;

  // Draw image scaled to fill
  const scale = Math.max(canvas.width / img.width, canvas.height / img.height);
  const sw = canvas.width / scale;
  const sh = canvas.height / scale;
  const sx = (img.width - sw) / 2;
  const sy = (img.height - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  // Semi-transparent dark overlay at bottom
  const gradient = ctx.createLinearGradient(0, canvas.height * 0.35, 0, canvas.height);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(0.5, "rgba(0,0,0,0.4)");
  gradient.addColorStop(1, "rgba(0,0,0,0.85)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Accent bar
  const accent = config.accentColor || "#eab308";
  ctx.fillStyle = accent;
  ctx.fillRect(50, canvas.height - 200, 6, 64);

  // Title (word wrap)
  ctx.fillStyle = config.textColor || "#ffffff";
  ctx.textBaseline = "bottom";

  const maxWidth = canvas.width - 120;
  const lineHeight = 58;
  let fontSize = 50;

  // Auto-size title to fit
  ctx.font = `bold ${fontSize}px "Geist", "Inter", system-ui, sans-serif`;
  while (ctx.measureText(config.title).width > maxWidth && fontSize > 28) {
    fontSize -= 2;
    ctx.font = `bold ${fontSize}px "Geist", "Inter", system-ui, sans-serif`;
  }

  // Word wrap
  const words = config.title.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line + word + " ";
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line.trim());
      line = word + " ";
    } else {
      line = test;
    }
  }
  if (line.trim()) lines.push(line.trim());

  // Draw lines bottom-up
  const startY = canvas.height - 140 + (lines.length - 1) * lineHeight;
  for (let i = lines.length - 1; i >= 0; i--) {
    ctx.fillText(lines[i], 70, startY - (lines.length - 1 - i) * lineHeight);
  }

  // Subtitle
  if (config.subtitle) {
    ctx.font = "22px 'Geist', 'Inter', system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.fillText(config.subtitle, 70, canvas.height - 40);
  }

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to create blob"));
    }, "image/jpeg", 0.92);
  });
}

export async function generateAllThumbnailsFromImage(
  imageUrl: string,
  topics: { index: number; title: string }[],
  config: Partial<ThumbnailConfig> = {}
): Promise<{ index: number; title: string; blob: Blob; url: string }[]> {
  const results = [];
  for (const topic of topics) {
    const blob = await generateThumbnailFromImage(imageUrl, {
      title: topic.title,
      ...config,
    });
    const url = URL.createObjectURL(blob);
    results.push({ index: topic.index, title: topic.title, blob, url });
  }
  return results;
}
