import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/lib/middleware/with-auth";
import { parseDealFromText, parseDealDemo } from "@/lib/ai/parse-deal";
import { z } from "zod";

const parseSchema = z.object({
  rawText: z.string().min(10, "Please provide at least 10 characters of deal text"),
});

// POST /api/deals/parse — extract structured deal data from unstructured text
export const POST = withAuth(
  async (req: NextRequest) => {
    const body = await req.json();
    const parsed = parseSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid input" },
        { status: 400 }
      );
    }

    const { rawText } = parsed.data;
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

    try {
      if (hasApiKey) {
        const result = await parseDealFromText(rawText);
        return NextResponse.json({ ...result, mode: "ai" });
      } else {
        // Demo mode — basic regex extraction
        const result = parseDealDemo(rawText);
        return NextResponse.json({
          ...result,
          mode: "demo",
          demoNotice: "AI parsing requires ANTHROPIC_API_KEY. Showing basic regex extraction.",
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Parsing failed";
      return NextResponse.json({ error: message }, { status: 500 });
    }
  },
  { roles: ["operator", "admin"] }
);
