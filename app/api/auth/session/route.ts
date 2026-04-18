import { NextResponse } from "next/server";
import { getAuthenticatedAddress } from "@/lib/auth";

export async function GET(req: Request) {
  const address = await getAuthenticatedAddress(req);
  if (!address) {
    return NextResponse.json({ authenticated: false });
  }

  return NextResponse.json({ authenticated: true, address });
}
