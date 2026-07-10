import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/env";

/** Liveness probe. Public by design (no tenant data). */
export function GET() {
  return NextResponse.json({
    status: "ok",
    mode: isDemoMode ? "demo" : "live",
    version: "v1",
  });
}
