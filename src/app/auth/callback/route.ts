import { NextResponse, type NextRequest } from "next/server";

/** Authentication has been removed — nothing to exchange a code for anymore. */
export async function GET(request: NextRequest) {
  return NextResponse.redirect(new URL("/dashboard", request.url));
}
