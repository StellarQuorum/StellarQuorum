# Quorum Architecture

## Overview

Quorum is a monorepo containing four main packages:

1. **frontend/** — Next.js governance explorer and voting UI
2. **contracts/** — Soroban smart contracts (governance + QUORUM token)
3. **sdk/** — TypeScript client SDK for dApp integration
4. **scripts/** — Deployment and operational tooling

## Data Flow

```
Voter (Freighter Wallet)
        │
        │ Signs XDR transaction
        ▼
QuorumClient (sdk/)
        │
        │ Submits to Stellar RPC
        ▼
GovernanceContract (Soroban)
        │
        ├── Stores proposal state
        ├── Records votes
        ├── Checks quorum
        └── Emits on-chain events
                │
                ▼
        Stellar Ledger
```

## Contract Interaction Pattern

All state-changing operations follow this pattern:
1. Client builds an unsigned transaction (XDR) via `QuorumClient.build*()`
2. User signs with Freighter wallet
3. Client submits signed XDR to the Soroban RPC node
4. Contract validates authorization via `require_auth()`
5. State is updated and events are emitted
