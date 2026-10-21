# Quorum FAQ

Frequently asked questions for contributors and users of Quorum governance.

---

## User FAQ

### Governance Participation

**Q: Why didn't my vote count?**

A: Your vote may not count for several reasons:
- **No voting power:** You didn't hold QUORUM tokens at the proposal's snapshot ledger. Voting power is based on your balance at the snapshot, not your current balance. Tokens acquired after the snapshot carry zero weight for that proposal.
- **Already voted:** Each address keeps one recorded choice per proposal. While voting is open you can change it by voting again; after the window closes, a repeat vote is rejected and your vote is final.
- **Proposal already finalized:** Voting is only allowed during the voting period (default: 24 hours). Once the period ends, no new votes are accepted.

**Q: Why do I need tokens at the snapshot ledger and not now?**

A: Voting power is frozen at the snapshot ledger (the ledger when the proposal was created) to prevent flash-loan attacks. Without this, an attacker could borrow a large amount of QUORUM, vote, and return it in a single transaction—manipulating governance outcomes. The snapshot ensures voting power reflects genuine long-term holding.

**Q: How do I claim Drips Wave points?**

A: Drips Wave points are automatically awarded to contributors who complete issues labeled with `drips:*`. After your pull request is merged, the Drips Wave automation tracks your contribution and assigns points. There is no manual claiming process—points are calculated based on the issue's points label and your contribution. See [CONTRIBUTING.md](../CONTRIBUTING.md#drips-wave) for details.

**Q: What is quorum and why is it required?**

A: Quorum is the minimum total voting power (For + Against + Abstain) required for a proposal to be eligible for execution. Without quorum, a proposal fails regardless of the vote distribution. Quorum prevents a small group from passing proposals that affect everyone. The default quorum threshold is 5% of circulating QUORUM supply.

**Q: Can I change my vote after casting it?**

A: No. Once a vote is cast, it cannot be changed or withdrawn. This is a deliberate design choice to prevent vote manipulation and ensure vote tallies are stable. Consider your decision carefully before voting.

**Q: What happens during the timelock period?**

A: After a proposal passes (quorum reached and For > Against), it enters a timelock period (default: 12 hours). During this window, the guardian multisig can veto the proposal as a safety net against governance attacks. Once the timelock expires, the proposal can be executed.

**Q: Who is the guardian and what can they do?**

A: The guardian is a trusted security multisig that can veto queued proposals during the timelock window. They cannot create, vote on, or execute proposals—only veto as a last-resort safety measure. The guardian is typically composed of security experts, protocol founders, and trusted advisors.

**Q: How do I delegate my voting power?**

A: Delegation is planned but not yet implemented. Currently, voting power is strictly your token balance at the snapshot ledger. Once delegation is available, you'll be able to delegate your voting power to a trusted representative without transferring your tokens. See the [delegate incentive program design](./delegate-incentive-program.md) for the planned delegation model.

**Q: What is the difference between "For," "Against," and "Abstain"?**

A:
- **For:** You support the proposal. Your voting power adds to the "For" tally.
- **Against:** You oppose the proposal. Your voting power adds to the "Against" tally.
- **Abstain:** You don't have a strong opinion but want to signal participation. Your voting power adds to the "Abstain" tally and counts toward quorum, but does not affect the For vs. Against comparison.

**Q: Why do proposals sometimes fail even if most votes are "For"?**

A: A proposal fails if:
- Quorum is not reached (total votes < quorum threshold)
- Against votes ≥ For votes
- The proposal is cancelled by the proposer or admin

Even if 90% of votes are "For," the proposal fails if quorum is not met (e.g., only 1% of supply voted when 5% is required).

---

## Contributor FAQ

### Development

**Q: How do I run the frontend locally?**

A:
```bash
cd frontend
npm install
npm run dev
```
The dev server starts at http://localhost:3000. See [CONTRIBUTING.md](../CONTRIBUTING.md#development-setup) for full setup instructions.

**Q: How do I run the contract tests?**

A:
```bash
cd contracts
cargo test
```
See [CONTRIBUTING.md](../CONTRIBUTING.md#running-tests) for the complete test suite guide, including mutation testing and fuzz testing.

**Q: What should I do if a contract test fails?**

A:
1. Check if the failure is in your changes or pre-existing
2. If in your changes, review the logic against the contract's design (see [architecture.md](./architecture.md))
3. Use `cargo test -- --nocapture` to see print output
4. If the failure is unclear, open an issue with reproduction steps

**Q: How do I add a new contract function?**

A:
1. Add the function to `contracts/governance/src/lib.rs` or `contracts/token/src/lib.rs`
2. Follow existing patterns: use `Result<T, ContractError>`, call `require_auth()`, use checked arithmetic
3. Emit an event via `env.events().publish()` for every state change
4. Add unit tests in `src/tests.rs`
5. Document the function in the contract's `README.md`
See [CONTRIBUTING.md](../CONTRIBUTING.md#contributing-to-contracts) for details.

**Q: Why did the WASM size check fail in CI?**

A: Soroban charges rent on deployed contract bytes, so artifact size is a real cost. CI fails if either artifact grows more than 10% over the committed baseline. If the growth is intentional (e.g., a new feature), update the baseline in `contracts/wasm-size-baseline.txt` and explain the growth in the PR description. See [CONTRIBUTING.md](../CONTRIBUTING.md#wasm-size-baseline) for details.

**Q: How do I add a new SDK method?**

A:
1. Add the method signature and JSDoc to `sdk/src/client.ts`
2. For read methods: use `simulateTransaction` and parse the `retval`
3. For transaction builders: use `prepareTransaction` and return the XDR string
4. Export new types from `sdk/src/index.ts`
5. Throw `QuorumSDKError` (not generic `Error`) with appropriate error codes
See [CONTRIBUTING.md](../CONTRIBUTING.md#contributing-to-the-sdk) for details.

**Q: What's the difference between the governance contract and the token contract?**

A:
- **Governance contract:** Manages proposals, voting, quorum calculation, timelock, and execution. It depends on the token contract for balance checks.
- **Token contract:** Manages QUORUM token balances, transfers, allowances, minting, burning, and checkpoints for snapshot voting power. It does not depend on the governance contract.

See [architecture.md](./architecture.md) for the full data flow.

**Q: How do I deploy contracts to testnet?**

A:
```bash
NETWORK=testnet SOURCE_ACCOUNT=G... bash scripts/deploy.sh
```
The script builds both contracts, deploys them, and prints the contract IDs. See [deployment.md](./deployment.md) for details.

**Q: What is the snapshot ledger and why is it important?**

A: The snapshot ledger is the ledger sequence when a proposal is created. Voting power is read from this ledger, not the current balance. This prevents flash-loan attacks and ensures voting power reflects genuine holding at the time the proposal opened. The token contract implements this with checkpointed balances—see [architecture.md](./architecture.md#balance-checkpoints-and-snapshot-voting-power).

---

### Governance and Community

**Q: How do I write a governance proposal?**

A: Start with the [Proposal Style Guide](./proposal-style-guide.md) to understand the required sections and tone. Then review [Example Governance Proposals](./proposal-examples.md) for realistic examples. Discuss your idea in [GitHub Discussions > Governance Questions](https://github.com/StellarQuorum/StellarQuorum/discussions/categories/governance-questions) before submitting on-chain.

**Q: What are good first issues?**

A: Good first issues are beginner-friendly tasks that help new contributors get started. They are labeled with `good first issue` and typically involve documentation, small UI changes, or test additions. See the [Good First Issue Curation](./good-first-issue-curation.md) document for how we identify and curate these issues.

**Q: How do I join community calls?**

A: Community calls and office hours are detailed in [Community Calls](./community-calls.md). Join to ask questions, share updates, and participate in governance discussions in real-time.

**Q: What is the difference between admin and guardian?**

A:
- **Admin:** Can cancel any proposal (before or after voting). Should be held in a multisig. Cannot vote, execute, or change parameters.
- **Guardian:** Can veto queued proposals during the timelock window. Should be a dedicated security multisig. Cannot create, vote, execute, or cancel proposals.

See [security-model.md](./security-model.md) for the full threat model and trust assumptions.

**Q: Can governance parameters be changed after deployment?**

A: No. Governance parameters (`quorum_bps`, `voting_period`, `timelock_period`, `proposal_threshold`) are set once at initialization and cannot be changed. To change parameters, you must deploy a new governance instance and migrate tokens. This is a deliberate design choice to prevent parameter manipulation. See [governance-parameters.md](./governance-parameters.md) for guidance on choosing parameters.

**Q: How do I report a security vulnerability?**

A: See [SECURITY.md](../SECURITY.md) for the security policy. Do not open a public issue—contact the maintainers privately via the disclosed channel.

---

## General FAQ

**Q: What is Quorum?**

A: Quorum is open-source governance infrastructure for the Stellar and Soroban ecosystem. It provides the core primitives for decentralized, token-weighted decision-making: proposal creation, on-chain voting, delegation (planned), timelock execution, and transparent result reporting. See the [README](../README.md) for an overview.

**Q: What networks does Quorum support?**

A: Quorum is designed for Stellar and Soroban. It can be deployed to Stellar testnet and mainnet. The SDK supports both networks via configuration.

**Q: Is Quorum audited?**

A: A security audit is planned but not yet completed. Until then, use Quorum on testnet only. The contract code includes mutation testing and fuzz testing to catch edge cases—see [mutation-testing.md](./mutation-testing.md) for the latest results.

**Q: How do I integrate Quorum into my dApp?**

A: Use the Quorum SDK (`@quorum/sdk`) to read proposals, build transactions, and sign with Freighter. See the [SDK README](../sdk/README.md) for installation and usage examples, and the [Protocol Integration Guide](./protocol-integration-guide.md) for a detailed integration walkthrough.

**Q: What is the roadmap?**

A: The roadmap is in the [README](../README.md#roadmap). Key upcoming items include:
- Sign and submit votes on testnet through Freighter
- Token delegation UI
- Timelock execution engine
- Multi-sig proposal creation
- Governor contract security audit

**Q: How do I get help?**

A:
- **Technical questions:** Open an issue or discussion on GitHub
- **Governance questions:** Post in [GitHub Discussions > Governance Questions](https://github.com/StellarQuorum/StellarQuorum/discussions/categories/governance-questions)
- **Community calls:** Join live Q&A at [Community Calls](./community-calls.md)
- **Bug reports:** Use the [bug report issue template](../.github/ISSUE_TEMPLATE/bug_report.md)

**Q: Can I use Quorum for my own protocol?**

A: Yes! Quorum is designed to be adopted by DeFi protocols, DAOs, and community organizations. See the [Governance Adoption Playbook](./governance-playbook.md) for a step-by-step guide to adopting Quorum, including parameter selection, security configuration, and deployment.

**Q: What license is Quorum under?**

A: Quorum is MIT-licensed. You are free to use, modify, and distribute it. See the [LICENSE](../LICENSE) file for details.

---

## Still Have Questions?

If your question isn't answered here:
- Search the [GitHub issues](https://github.com/StellarQuorum/StellarQuorum/issues) and [discussions](https://github.com/StellarQuorum/StellarQuorum/discussions)
- Open a new discussion with the `question` label
- Join a [community call](./community-calls.md) for live help
