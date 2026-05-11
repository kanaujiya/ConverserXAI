import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // HeyGen avatar videos (e.g. from files.heygen.ai, resource.heygen.ai) are
  // rendered with a plain HTML <video> element, not the Next.js <Image> component.
  // Because of this, no `images.remotePatterns` entry is required for HeyGen domains —
  // the browser fetches video URLs directly without going through Next.js image optimization.
};

export default nextConfig;
