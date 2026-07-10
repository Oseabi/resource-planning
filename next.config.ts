import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // CV / RFQ files travel through server actions on save; match the
      // storage bucket's 10 MB file limit (Next.js default is 1 MB).
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
