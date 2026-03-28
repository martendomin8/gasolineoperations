import { Resend } from "resend";

// Lazily initialised — only fails at send time if key is missing, not at import
function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

export interface SendEmailParams {
  to: string;          // comma-separated or single address
  cc?: string;
  subject: string;
  body: string;        // plain-text — we'll wrap in minimal HTML
  from?: string;       // defaults to env var or onboarding address
  replyTo?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  mode: "sent" | "demo";  // "demo" when RESEND_API_KEY is not set
  error?: string;
}

function bodyToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const lines = escaped.split("\n").map((l) => `<p style="margin:0 0 4px 0">${l || "&nbsp;"}</p>`).join("\n");
  return `<!DOCTYPE html><html><body style="font-family:monospace;font-size:13px;color:#1a1a1a;padding:24px;max-width:700px">${lines}</body></html>`;
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const resend = getResend();

  // No API key → demo mode: log and return success
  if (!resend) {
    console.log("[email:demo] Would send:", {
      to: params.to,
      subject: params.subject,
      bodyPreview: params.body.slice(0, 120),
    });
    return { success: true, mode: "demo" };
  }

  const fromAddress =
    params.from ??
    process.env.EMAIL_FROM ??
    "NomEngine <noreply@nominationengine.com>";

  const toArray = params.to
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  try {
    const result = await resend.emails.send({
      from: fromAddress,
      to: toArray,
      ...(params.cc ? { cc: params.cc.split(/[,;]/).map((s) => s.trim()).filter(Boolean) } : {}),
      ...(params.replyTo ? { replyTo: params.replyTo } : {}),
      subject: params.subject,
      html: bodyToHtml(params.body),
      text: params.body,
    });

    if (result.error) {
      console.error("[email] Resend error:", result.error);
      return { success: false, mode: "sent", error: result.error.message };
    }

    return { success: true, mode: "sent", messageId: result.data?.id };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown email error";
    console.error("[email] Send failed:", message);
    return { success: false, mode: "sent", error: message };
  }
}
