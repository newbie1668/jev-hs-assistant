import { NextResponse } from "next/server";

/** Parse a JSON request body; returns null when the body is malformed JSON. */
export async function readJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export function invalidJsonResponse(): NextResponse {
  return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
}
