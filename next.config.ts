import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/jobs/*": ["./src/lib/**"],
  },
};

export default nextConfig;
