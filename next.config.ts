import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep these deps out of the server bundle — they ship native code / large
  // ESM trees (pdfjs-dist) that Turbopack/webpack mangles, and they must
  // resolve at runtime against the Node module graph.
  serverExternalPackages: ["postgres", "pdf-parse", "pdfjs-dist", "mammoth"],
};

export default nextConfig;
