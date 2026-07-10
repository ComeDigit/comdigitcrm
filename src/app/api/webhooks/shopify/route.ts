import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isDemoMode } from "@/lib/env";

/**
 * Shopify webhook receiver. Dumb on purpose: verify HMAC → store raw →
 * 200 fast. Processing happens asynchronously via the job queue.
 * Public route (webhooks can't log in) — HMAC IS the authentication.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  const hmacHeader = request.headers.get("x-shopify-hmac-sha256");
  const topic = request.headers.get("x-shopify-topic") ?? "unknown";
  const eventId = request.headers.get("x-shopify-webhook-id");

  const rawBody = await request.text();

  if (!secret || !hmacHeader || !eventId) {
    return NextResponse.json({ error: "bad request" }, { status: 401 });
  }

  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const provided = Buffer.from(hmacHeader, "base64");
  if (
    digest.length !== provided.length ||
    !timingSafeEqual(digest, provided)
  ) {
    return NextResponse.json({ error: "invalid hmac" }, { status: 401 });
  }

  if (isDemoMode) return NextResponse.json({ ok: true, mode: "demo" });

  const { getDb } = await import("@/lib/db");
  const { webhookInbox } = await import("@/db/schema");

  await getDb()
    .insert(webhookInbox)
    .values({
      provider: "shopify",
      eventId,
      topic,
      payload: JSON.parse(rawBody) as Record<string, unknown>,
    })
    .onConflictDoNothing(); // duplicate deliveries are expected — ignore

  return NextResponse.json({ ok: true });
}
