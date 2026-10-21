import { NextResponse } from "next/server";
import { getProposalById } from "@/lib/proposals";

/**
 * JSON for a single proposal, so the detail page can refresh its vote counts
 * from the browser (issue #41). Never cached: each poll must see new votes.
 */
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  try {
    const proposal = await getProposalById(id);
    if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
    return NextResponse.json(proposal);
  } catch {
    return NextResponse.json({ error: "Proposal is unavailable" }, { status: 500 });
  }
}
