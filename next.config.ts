import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["yt-dlp-wrap"],
  outputFileTracingIncludes: {
    "/api/jobs/*": ["./src/lib/**"],
  },
};

export default nextConfig;
