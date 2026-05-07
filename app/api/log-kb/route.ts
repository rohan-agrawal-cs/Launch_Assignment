import { NextRequest, NextResponse } from "next/server";

/** Characters per line (each call adds one newline). */
const LINE_WIDTH = 256;

/**
 * GET /api/log-kb?size=1024
 * Prints ~1024 KiB of console.log output (ASCII + newline per line).
 */
export async function GET(request: NextRequest) {
  const raw = new URL(request.url).searchParams.get("size");
  const sizeKb = Math.max(1, parseInt(raw || "1", 10) || 1);
  const targetBytes = sizeKb * 1024;

  let written = 0;
  while (written < targetBytes) {
    const remaining = targetBytes - written;
    const maxChunk = remaining - 1; // account for newline from console.log
    if (maxChunk <= 0) {
      console.log("");
      written += 1;
      continue;
    }
    const chunk = Math.min(LINE_WIDTH, maxChunk);
    console.log("x".repeat(chunk));
    written += chunk + 1;
  }

  return NextResponse.json({
    ok: true,
    size_kb: sizeKb,
    approx_console_bytes: targetBytes,
  });
}
