import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The original dataset is read from disk at runtime; make sure serverless bundles include it.
  outputFileTracingIncludes: {
    "/api/**/*": ["./data/seed/**/*"],
  },
};

export default nextConfig;
