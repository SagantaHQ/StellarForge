import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/contracts/list?projectId=X&network=Y
 *
 * Returns deployed contracts for a project (optionally filtered by network).
 * Includes all WASM versions for each contract.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const projectId = url.searchParams.get("projectId");
    const network = url.searchParams.get("network");

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    const where: { projectId: string; network?: string } = { projectId };
    if (network) where.network = network;

    const contracts = await db.deployedContract.findMany({
      where,
      include: {
        wasmVersions: {
          orderBy: { version: "desc" },
        },
      },
      orderBy: { updatedAt: "desc" },
    });

    return NextResponse.json({
      contracts: contracts.map((c) => ({
        id: c.id,
        contractId: c.contractId,
        network: c.network,
        deployerAddress: c.deployerAddress,
        wasmHash: c.wasmHash,
        isUpgradeable: c.isUpgradeable,
        upgradeCount: c.upgradeCount,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
        wasmVersions: c.wasmVersions.map((v) => ({
          id: v.id,
          wasmHash: v.wasmHash,
          wasmSizeBytes: v.wasmSizeBytes,
          version: v.version,
          isUpgrade: v.isUpgrade,
          createdAt: v.createdAt.toISOString(),
        })),
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch contracts", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
