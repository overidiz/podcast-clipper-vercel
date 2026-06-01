import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@distube/ytdl-core"],
  outputFileTracingIncludes: {
    "/api/jobs/*": ["./src/lib/**"],
  },
};

export default nextConfig;
