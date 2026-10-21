# QUORUM Token Distribution and Vesting

## Overview

QUORUM is the governance token of the Quorum protocol. It determines voting
power over protocol upgrades, parameter changes, treasury allocations, and
ecosystem grants. The distribution below is designed so that no single party
controls governance at launch.

## Total Supply

| Parameter               | Value              |
| ----------------------- | ------------------ |
| Maximum total supply    | 1,000,000,000 QUORUM |
| Initial circulating supply | ~100,000,000 QUORUM (10%) |
| Decimals                | 7                  |

## Distribution Table

| Category                     | Allocation | Amount (QUORUM)   | Vesting                                       |
| ---------------------------- | ---------: | ----------------: | --------------------------------------------- |
| Core team                    |       20%  |   200,000,000     | 1-year cliff, 3-year linear vest              |
| Community treasury (DAO)     |       30%  |   300,000,000     | Governed by token holders from day 1          |
| Drips Wave contributor pool  |       15%  |   150,000,000     | No cliff; released per Drips Wave sprint      |
| Early adopter airdrop        |       10%  |   100,000,000     | No cliff; claimable at launch                 |
| Ecosystem fund (grants)      |       15%  |   150,000,000     | Released by DAO vote for governance tooling   |
| Liquidity and market making  |       10%  |   100,000,000     | 6-month linear vest from TGE                  |

**Total**: 1,000,000,000 QUORUM

## Vesting Details

### Core Team (20%)

- **Cliff**: 12 months from Token Generation Event (TGE).
- **Vesting**: linear over the following 36 months (48 months total).
- **Rationale**: aligns long-term incentives; team cannot dump at launch.

### Community Treasury (30%)

- Controlled by QUORUM holders via governance from day 1.
- Disbursements require a passed governance proposal.
- Intended for bug bounties, grants, integrations, and protocol improvements.

### Drips Wave Contributor Pool (15%)

- Released per sprint as contributors complete Drips Wave issues.
- No cliff; rewards are proportional to contribution size.
- Governed by the Drips platform rules rather than on-chain governance.

### Early Adopter Airdrop (10%)

- Reserved for protocols and wallets that integrate Quorum before TGE.
- Snapshot taken at TGE; no lock-up period.
- Unclaimed tokens revert to the community treasury after 12 months.

### Ecosystem Fund (15%)

- Disbursed by DAO vote for governance tooling, audits, and research.
- Each grant requires a separate governance proposal.

### Liquidity and Market Making (10%)

- 6-month linear vest from TGE.
- Managed by DAO-approved market makers under a service agreement.

## Inflation Schedule

The QUORUM token has a **fixed maximum supply** of 1,000,000,000. There is no
scheduled inflation. The only supply-increasing mechanism is admin-controlled
`mint()` on the token contract; in production the admin is the governance
contract itself, so any new issuance requires a token-holder vote.

## Initial Circulating Supply

At TGE, the circulating supply is approximately **100,000,000 QUORUM** (10%),
composed of:
- Early adopter airdrop: 100,000,000 QUORUM (immediately claimable)

All other allocations are locked or governed, keeping initial float low to
prevent governance capture on day one.
