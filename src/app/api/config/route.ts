import { NextResponse } from "next/server";
import { serverConfig } from "@/lib/config/server-config";

/**
 * GET /api/config
 *
 * Returns the server-side configuration (read-only).
 * The client reads this to determine which features are available
 * (e.g. autocomplete mode, LSP server status).
 *
 * This is NOT user-configurable — only admins can change it by editing
 * src/lib/config/server-config.ts on the server.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    autocompleteMode: serverConfig.autocompleteMode,
    lspServerEnabled: serverConfig.lspServerEnabled,
    lspPort: serverConfig.lspPort,
  });
}
