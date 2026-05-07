import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

/** Directory containing this config — fixes Tailwind/postcss resolving from a parent folder (e.g. Desktop) when cwd or Turbopack root is wrong. */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  /* config options here */
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.contentstack.io',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'eu-images.contentstack.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'assets.contentstack.io',
        port: '',
        pathname: '/**',
      },
    ],
  },
  // Enable experimental features if needed
  experimental: {
    // Enable Server Actions if needed
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
