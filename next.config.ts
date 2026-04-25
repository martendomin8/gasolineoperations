import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep these deps out of the server bundle — they ship native code / large
  // ESM trees (pdfjs-dist) that Turbopack/webpack mangles, and they must
  // resolve at runtime against the Node module graph.
  serverExternalPackages: [
    "postgres",
    "pdf-parse",
    "pdfjs-dist",
    "mammoth",
    "searoute-js",
    "mailparser",
  ],

  // The CP Q&A endpoint reads charter-party reference markdowns from
  // DATA/Charter Parties/<form>/ at runtime. Vercel's serverless functions
  // only ship files Next.js's tracer followed from imports — dynamic
  // fs.readFile() paths aren't traced. Without this hint the deployment
  // bundle would land without the reference docs and the endpoint would
  // always answer "(reference not available)" in production. Glob covers
  // every current and future base form (BPVOY4, BPVOY5, Asbatankvoy,
  // Shellvoy 6, Mobilvoy) without per-form entries.
  outputFileTracingIncludes: {
    "/api/linkages/[id]/cp-qa": [
      "./DATA/Charter Parties/**/*.md",
    ],
  },
};

export default nextConfig;
