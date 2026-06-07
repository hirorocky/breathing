import type { NextConfig } from "next";

const WORKER_DEV_ORIGIN =
  process.env.WORKER_DEV_ORIGIN ?? "http://localhost:8787";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  async rewrites() {
    if (process.env.NODE_ENV === "development") {
      return [
        {
          source: "/api/:path*",
          destination: `${WORKER_DEV_ORIGIN}/api/:path*`,
        },
      ];
    }
    return [];
  },
};

export default nextConfig;
