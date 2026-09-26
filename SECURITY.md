# Security Policy

Stellar Quorum is governance infrastructure: a flaw in the contracts can affect
voting power, proposal execution and funds controlled by a DAO. Please report
vulnerabilities privately so they can be fixed before they are disclosed.

## Reporting a vulnerability

**Do not open a public issue, pull request or discussion for a suspected
vulnerability.**

Use GitHub private vulnerability reporting:

1. Go to the [Security tab](https://github.com/StellarQuorum/StellarQuorum/security)
   of this repository.
2. Choose **Report a vulnerability**.
3. Describe the issue, affected component and version or commit, reproduction
   steps or a proof of concept, and the impact you expect.

Reports are visible only to you and the maintainers. If you cannot use GitHub
private reporting, open a public issue that says only that you need a private
channel, without any technical detail, and a maintainer will arrange one.

## What to expect

| Step | Target |
|---|---|
| Acknowledgement of your report | within 3 business days |
| Initial assessment and severity | within 7 days |
| Status updates | at least every 14 days until resolved |
| Fix or mitigation for critical and high severity | within 30 days where feasible |

These are targets, not guarantees; this is a volunteer-maintained project. We
will coordinate a disclosure date with you and credit you in the advisory
unless you prefer to remain anonymous. Please allow a reasonable time to fix
the issue before disclosing it publicly.

## Scope

In scope:

- **Smart contracts** in `contracts/`: the governance contract
  (`contracts/governance`) and the QUORUM token contract (`contracts/token`),
  for example authorization bypasses, vote or delegation accounting errors,
  quorum/timelock circumvention, arithmetic overflow, and denial of service.
- **TypeScript SDK** in `sdk/` (`@quorum/sdk`): for example incorrect
  transaction construction or unsafe handling of keys and signatures.
- **Frontend** in `frontend/`: for example XSS, wallet-interaction flaws, and
  displaying data that misrepresents on-chain state.
- **Deployment tooling** in `scripts/` and `.github/workflows/` that could
  leak secrets or deploy unintended code.

Out of scope:

- Vulnerabilities in third-party dependencies with no demonstrated impact here
  (report them upstream; automated `cargo audit` and `npm audit` already run in
  CI).
- Issues in the Stellar network, Soroban runtime or wallets themselves.
- Findings that require a compromised admin key or a compromised user device.
- Social engineering, spam, and volumetric denial-of-service.
- Contracts deployed by third parties from this code.

## Safe harbour

We will not pursue action against researchers who act in good faith: they test
only against their own accounts or testnet deployments, avoid privacy
violations and service disruption, and give us reasonable time to respond
before disclosure.

## Supported versions

The project is pre-1.0; only the latest commit on `main` is supported.
