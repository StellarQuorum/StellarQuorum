# Quorum Governance Contract

Soroban smart contract implementing on-chain governance for the Quorum protocol.

## Functions
- `initialize` — set config, quorum params, token address
- `create_proposal` — create a new proposal (requires token balance >= threshold)
- `vote` — cast For/Against/Abstain vote on active proposal
- `finalize` — evaluate quorum after voting period ends
- `execute` — execute queued proposal after timelock
- `cancel` — cancel by proposer or admin
