import type { Proposal } from "./types";

export const PROPOSALS: Proposal[] = [
  {
    id: "QIP-001",
    title: "Increase Protocol Fee to 0.05%",
    description: "This proposal increases the base protocol fee from 0.03% to 0.05% on all swaps processed through the Quorum-governed liquidity pools. The additional fee revenue will be directed 60% to the treasury and 40% to active liquidity providers.\n\nThe current fee level was set in Genesis and has not been revisited despite significant growth in protocol TVL. An increase to 0.05% aligns Quorum with comparable governance protocols in other ecosystems.\n\nAll existing fee exemptions for governance token stakers will remain in place.",
    proposer: "GABC...3XZK",
    status: "active",
    startTime: "2026-05-12T10:00:00Z",
    endTime: "2026-05-19T10:00:00Z",
    forVotes: 842000,
    againstVotes: 124000,
    abstainVotes: 34000,
    quorumRequired: 500000,
    category: "Financial",
    actions: [{ description: "Update fee parameter in FeeController contract", contractAddress: "CCFEECONTROLLER...A7BX", functionName: "set_fee_bps" }],
    votes: [
      { voter: "GDEF...8YPQ", choice: "for", weight: 120000, timestamp: "2026-05-12T14:22:00Z" },
      { voter: "GHIJ...2WNM", choice: "for", weight: 85000, timestamp: "2026-05-13T09:15:00Z" },
      { voter: "GKLM...5TRV", choice: "against", weight: 94000, timestamp: "2026-05-13T11:40:00Z" },
    ],
  },
  {
    id: "QIP-002",
    title: "Add USDC as Accepted Collateral",
    description: "This proposal adds Circle's USDC (issued on Stellar) as accepted collateral in the Quorum lending protocol. USDC would have an initial loan-to-value ratio of 90% and a liquidation threshold of 95%.\n\nUSDC is one of the most liquid assets on the Stellar network. Its inclusion as collateral would meaningfully expand borrowing capacity for users who hold USDC.\n\nThe Chainlink Stellar price feed for USDC/USD will be used for oracle pricing.",
    proposer: "GXYZ...7MKL",
    status: "passed",
    startTime: "2026-04-28T00:00:00Z",
    endTime: "2026-05-05T00:00:00Z",
    forVotes: 1200000,
    againstVotes: 89000,
    abstainVotes: 45000,
    quorumRequired: 500000,
    category: "Financial",
    actions: [{ description: "Register USDC as collateral asset", contractAddress: "CCOLLATERAL...B3QW", functionName: "add_collateral_asset" }],
    votes: [
      { voter: "GAAA...1BBB", choice: "for", weight: 450000, timestamp: "2026-04-28T08:00:00Z" },
      { voter: "GCCC...3DDD", choice: "for", weight: 320000, timestamp: "2026-04-29T12:00:00Z" },
      { voter: "GEEE...5FFF", choice: "against", weight: 89000, timestamp: "2026-04-30T15:00:00Z" },
    ],
  },
];

export function getProposalById(id: string): Proposal | undefined {
  return PROPOSALS.find(p => p.id === id);
}
