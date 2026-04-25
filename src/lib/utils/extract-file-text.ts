/**
 * File-to-text extraction shared between the dedicated /deals/parse upload
 * widget (FileDropZone) and inline drag-drop targets like the linkage view's
 * SALE/DISCHARGE and BUY card empty states.
 *
 * Browser-only — uses FileReader and TextDecoder. Do not import server-side.
 */

const ACCEPTED_EXTENSIONS = [".eml", ".msg", ".docx", ".pdf", ".txt"] as const;
export const ACCEPTED_FILE_EXTENSIONS = ACCEPTED_EXTENSIONS;

export class FileExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileExtractionError";
  }
}

export function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot >= 0 ? filename.slice(dot).toLowerCase() : "";
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new FileExtractionError("Failed to read file"));
    reader.readAsText(file);
  });
}

function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(new FileExtractionError("Failed to read file"));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Extract text from a .docx file (a ZIP containing word/document.xml).
 * Pulls <w:t> tag contents per <w:p> paragraph. No external deps.
 */
async function extractDocxText(file: File): Promise<string> {
  const buffer = await readAsArrayBuffer(file);
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder("utf-8");
  const fullText = decoder.decode(bytes);

  const docXmlMatch = fullText.match(/<w:body[\s\S]*?<\/w:body>/);
  if (!docXmlMatch) {
    throw new FileExtractionError(
      "Could not find document content in .docx file. Try copying the text and pasting it instead."
    );
  }

  const paragraphs = docXmlMatch[0].split(/<\/w:p>/);
  const result: string[] = [];

  for (const para of paragraphs) {
    const parts: string[] = [];
    const innerRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    let innerMatch;
    while ((innerMatch = innerRegex.exec(para)) !== null) {
      parts.push(innerMatch[1]);
    }
    if (parts.length > 0) {
      result.push(parts.join(""));
    }
  }

  const extracted = result.join("\n");
  if (!extracted.trim()) {
    throw new FileExtractionError(
      "No text content found in .docx file. Try copying the text and pasting it instead."
    );
  }

  return extracted;
}

/**
 * Extract plain text content from a recap file (.eml, .txt, .docx).
 *
 * Throws FileExtractionError for unsupported types, oversized files, or
 * read failures. Caller is responsible for surfacing the message in UI.
 */
export async function extractTextFromFile(file: File): Promise<string> {
  const ext = getFileExtension(file.name);

  if (!ACCEPTED_EXTENSIONS.includes(ext as (typeof ACCEPTED_EXTENSIONS)[number])) {
    throw new FileExtractionError(
      `Unsupported file type "${ext}". Accepted: ${ACCEPTED_EXTENSIONS.join(", ")}`
    );
  }

  if (file.size > 10 * 1024 * 1024) {
    throw new FileExtractionError("File is too large (max 10 MB).");
  }

  switch (ext) {
    case ".txt":
    case ".eml": {
      const text = await readAsText(file);
      if (!text.trim()) {
        throw new FileExtractionError("The file appears to be empty.");
      }
      return text;
    }
    case ".docx":
      return extractDocxText(file);
    case ".msg":
      throw new FileExtractionError(
        "MSG files use a binary format that requires server-side conversion. Open the email in Outlook, copy the text, and paste it instead."
      );
    case ".pdf":
      throw new FileExtractionError(
        "PDF text extraction is coming soon. Open the PDF, copy the text, and paste it instead."
      );
    default:
      throw new FileExtractionError(`Unsupported file type: ${ext}`);
  }
}
