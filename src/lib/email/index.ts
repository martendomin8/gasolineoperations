/**
 * Email module — V1 is copy-paste to Outlook only.
 * No programmatic sending. Drafts are generated and displayed in the UI;
 * the operator copies them into Outlook manually, then clicks "Mark Sent".
 */

export interface SendEmailParams {
  to: string;
  cc?: string;
  subject: string;
  body: string;
  from?: string;
  replyTo?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  mode: "copy_paste";
  error?: string;
}

/**
 * No-op in V1. Email sending is manual (copy-paste to Outlook).
 * Kept as a stub so callers don't break if they still reference it.
 */
export async function sendEmail(_params: SendEmailParams): Promise<SendEmailResult> {
  return { success: true, mode: "copy_paste" };
}
