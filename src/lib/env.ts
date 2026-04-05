const REQUIRED_VARS = ["DATABASE_URL", "NEXTAUTH_SECRET"] as const;

let validated = false;

export function validateEnv(): void {
  if (validated) return;
  const missing = REQUIRED_VARS.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
      `Check your .env file or Vercel environment settings.`
    );
  }
  validated = true;
}
