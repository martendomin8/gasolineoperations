import { del, put } from "@vercel/blob";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

// Production (Vercel) has a read-only filesystem; Blob is the only way to
// persist uploads between requests. Local dev without a Blob token falls
// back to `public/uploads/` so contributors can work without a token.
const useBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

function isRemoteUrl(storagePath: string): boolean {
  return storagePath.startsWith("https://") || storagePath.startsWith("http://");
}

function localAbsolutePath(storagePath: string): string {
  return path.join(process.cwd(), "public", storagePath);
}

export async function uploadDocument(
  key: string,
  bytes: Buffer,
  contentType?: string
): Promise<string> {
  if (useBlob) {
    const blob = await put(key, bytes, {
      access: "public",
      contentType,
      addRandomSuffix: true,
    });
    return blob.url;
  }

  const relativeUrl = `/uploads/${key}`;
  const absolute = path.join(process.cwd(), "public", "uploads", key);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes);
  return relativeUrl;
}

export async function readDocument(storagePath: string): Promise<Buffer> {
  if (isRemoteUrl(storagePath)) {
    const res = await fetch(storagePath);
    if (!res.ok) {
      throw new Error(`Blob fetch failed: ${res.status} ${res.statusText}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
  if (storagePath.startsWith("/uploads/")) {
    return readFile(localAbsolutePath(storagePath));
  }
  throw new Error(`Unrecognised storage path: ${storagePath}`);
}

export async function deleteDocument(storagePath: string): Promise<void> {
  if (isRemoteUrl(storagePath)) {
    await del(storagePath);
    return;
  }
  if (storagePath.startsWith("/uploads/")) {
    try {
      await unlink(localAbsolutePath(storagePath));
    } catch (err) {
      console.warn("[documents] unlink failed:", err);
    }
  }
}

export function hasReadableFile(storagePath: string | null | undefined): boolean {
  if (!storagePath) return false;
  return isRemoteUrl(storagePath) || storagePath.startsWith("/uploads/");
}
