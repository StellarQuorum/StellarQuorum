import type { QuorumClient } from "@quorum/sdk";
import type { WalletAdapter } from "@/lib/wallets/types";

export interface ProposalDraft {
  title: string;
  description: string;
}

export async function submitProposal(
  client: QuorumClient,
  wallet: WalletAdapter,
  proposer: string,
  draft: ProposalDraft,
): Promise<{ id: bigint; transactionHash: string }> {
  const previousCount = await client.getProposalCount();
  const xdr = await client.buildCreateProposal(proposer, draft.title, draft.description);
  const signed = await wallet.signTransaction(xdr);
  const confirmation = await client.submitAndWait(signed);
  const currentCount = await client.getProposalCount();
  for (let id = previousCount + BigInt(1); id <= currentCount; id++) {
    const proposal = await client.getProposal(id);
    if (proposal?.proposer === proposer && proposal.title === draft.title && proposal.description === draft.description) {
      return { id, transactionHash: confirmation.txHash };
    }
  }
  throw new Error(`Transaction ${confirmation.txHash} confirmed, but the created proposal could not be located.`);
}

export function formatProposalSubmissionError(error: unknown): string {
  const failure = error as { code?: unknown; contractErrorCode?: unknown } | null;
  const code = typeof failure?.code === "number" ? failure.code : failure?.contractErrorCode;
  const messages: Record<number, string> = {
    9: "The proposer is below the proposal threshold",
    30: "The proposer deposit is insufficient",
    33: "The proposer is still on cooldown",
  };
  if (typeof code === "number" && messages[code]) return messages[code];
  return error instanceof Error ? error.message : String(error);
}
