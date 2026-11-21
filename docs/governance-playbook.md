# Governance Adoption Playbook

This playbook is a step-by-step checklist for protocols adopting Quorum governance. It pulls together parameter selection, security configuration, and deployment decisions into a single adoption guide.

Use this playbook whether you're a DeFi protocol, DAO, or community organization ready to move to on-chain governance.

---

## Phase 1: Pre-Adoption Decisions

### 1.1 Governance Goals

Before deploying, answer these questions:

- **What decisions will be on-chain?** Parameter changes, treasury movements, protocol upgrades, or all of the above?
- **Who are your token holders?** Are they retail users, institutional investors, or a mix?
- **What is your timeline?** Do you need governance active immediately, or can you iterate on testnet first?

**Output:** A brief governance scope document (1-2 paragraphs) describing what will be governed and who participates.

### 1.2 Token Design

Quorum requires a governance token. Decide:

- **Existing token or new token?** If you have an existing ERC-20 or Stellar asset, you'll need to deploy a Soroban-wrapped version with checkpointing support.
- **Token distribution:** How is the governance token distributed? (airdrop, liquidity mining, sale, etc.)
- **Voting power rights:** Does holding the token grant governance rights immediately, or is there a vesting period?

**Output:** Token design document and distribution plan.

---

## Phase 2: Governance Parameter Selection

### 2.1 Choose Your Parameters

Quorum's governance parameters are set at initialization and cannot be changed. Use the guidance in [governance-parameters.md](./governance-parameters.md) to select values.

**Quick reference:**

| Parameter | Recommended for Small DeFi | Trade-off |
|-----------|---------------------------|-----------|
| `quorum_bps` | 500 (5%) | 5% balances participation vs. capture resistance |
| `voting_period` | 17,280 (~24 hours) | Global access vs. speed |
| `timelock_period` | 34,560 (~48 hours) | Security review vs. execution speed |
| `proposal_threshold` | 500,000,000,000 (50,000 tokens) | Spam prevention vs. accessibility |

**If your protocol is high-risk or handles large treasury values:**
- Increase `quorum_bps` to 750 (7.5%) or 1000 (10%)
- Increase `proposal_threshold` to require larger stake to propose
- Consider a longer `timelock_period` (e.g., 17,280 = ~24 hours)

**If your protocol is experimental or low-risk:**
- Decrease `quorum_bps` to 300 (3%) to ensure proposals pass
- Decrease `proposal_threshold` to lower barriers to participation

**Output:** A completed parameter selection table.

### 2.2 Governance Instance Strategy

Consider deploying multiple governance instances for different proposal types:

- **Standard governance:** Default parameters for routine proposals
- **Emergency governance:** Shorter voting period (6h) + shorter timelock (2h) for urgent fixes
- **Treasury governance:** Longer voting period (3d) + higher threshold for large fund movements

**Decision:** Do you need multiple instances? If yes, specify which proposal types go to which instance.

**Output:** Governance instance architecture diagram or description.

---

## Phase 3: Security Configuration

### 3.1 Admin Key Custody

The admin key can pause the contract and rotate the admin/guardian. **Do not use a single key.** The admin cannot cancel proposals; cancellation is proposer-only.

**Recommended setup:**
- Use a **multisig** (e.g., 3-of-5) for the admin key
- Distribute signers across team members and trusted community members
- Store multisig keys in hardware wallets
- Document the multisig configuration in a public repo

**Alternatives:**
- If multisig is not yet available, use a hardware wallet with a secure passphrase
- Plan to migrate to multisig within 3 months

**Output:** Admin key custody plan with signer list and recovery process.

### 3.2 Guardian Veto Configuration

The guardian is a security multisig that can veto proposals during the timelock window.

**Recommended setup:**
- Use a **dedicated security multisig** (separate from admin)
- Include security experts, protocol founders, and trusted external advisors
- Require a higher threshold than admin (e.g., 4-of-7)
- Document guardian policies: when to veto, response time expectations

**Guardian veto criteria:**
- Smart contract bugs or exploits
- Governance attacks (e.g., quorum manipulation)
- Legal or regulatory violations
- Treasury drain or unauthorized fund movements

**Output:** Guardian multisig configuration and veto policy document.

### 3.3 Security Model Review

Review the [security-model.md](./security-model.md) for threat assumptions and mitigations.

**Key security decisions:**
- Will you use the guardian veto? (Recommended: yes)
- Will you use a multisig for admin? (Recommended: yes)
- Will you deploy on testnet first? (Recommended: yes)

**Output:** Security configuration checklist signed off by your security lead.

---

## Phase 4: Deployment

### 4.1 Pre-Deployment Checklist

- [ ] Token design and distribution finalized
- [ ] Governance parameters selected
- [ ] Admin multisig configured
- [ ] Guardian multisig configured
- [ ] Testnet deployment plan approved
- [ ] Mainnet deployment timeline set
- [ ] RPC endpoint selected (testnet and mainnet)
- [ ] Source account funded with XLM for deployment fees

### 4.2 Testnet Deployment

Deploy to Stellar testnet first and run through a full governance cycle:

1. **Deploy contracts** using `scripts/deploy.sh` with `NETWORK=testnet`
2. **Verify deployment** using the commands in [deployment.md](./deployment.md)
3. **Create a test proposal** through the governance UI
4. **Vote on the proposal** with multiple accounts
5. **Finalize and execute** the proposal
6. **Test the guardian veto** (cancel a queued proposal)
7. **Confirm the admin cannot cancel** (the call must fail with `Unauthorized`)

**Success criteria:**
- All proposals finalize correctly
- Votes are counted accurately
- Timelock delays work as expected
- Guardian and admin functions work

**Output:** Testnet deployment report with test results.

### 4.3 Mainnet Deployment

Once testnet is verified, deploy to mainnet:

1. **Deploy contracts** using `scripts/deploy.sh` with `NETWORK=mainnet`
2. **Verify deployment** using the commands in [deployment.md](./deployment.md)
3. **Distribute governance tokens** according to your distribution plan
4. **Announce governance launch** to your community
5. **Monitor the first proposal cycle** closely

**Output:** Mainnet deployment report with contract IDs and transaction hashes.

---

## Phase 5: Post-Adoption

### 5.1 Community Onboarding

- **Publish a governance guide** for your token holders (how to vote, how to delegate)
- **Host a community call** to explain governance and answer questions
- **Create a governance category** in your Discord/Forum for proposal discussion
- **Set expectations** for proposal response times (e.g., proposals reviewed within 48 hours)

### 5.2 Monitoring and Iteration

Monitor these metrics weekly for the first 3 months:

- **Proposal volume:** How many proposals are created?
- **Quorum rate:** What % of proposals reach quorum?
- **Vote distribution:** Are votes concentrated or distributed?
- **Participation rate:** What % of circulating supply votes on average?

**If quorum is consistently missed:**
- Consider lowering `quorum_bps` (requires new governance instance)
- Increase community outreach and education
- Consider implementing delegation (if not yet available)

**If proposals are consistently passing with low participation:**
- Consider raising `quorum_bps` (requires new governance instance)
- Increase `proposal_threshold` to reduce spam

### 5.3 Parameter Adjustment Plan

Since parameters are immutable, plan for a future upgrade:

- **Document current parameters** and why they were chosen
- **Set a review date** (e.g., 6 months post-launch)
- **Plan a migration** if parameters need changing (new governance instance + token migration)

---

## Recommended Default Configuration: Small DeFi Protocol

This is a starting configuration for a "typical" small DeFi protocol (e.g., a DEX, lending protocol, or yield aggregator with 10-50k users and a 10M-100M token supply).

### Parameters

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `quorum_bps` | 500 (5%) | 5% balances participation with 10M supply = 500k tokens must vote |
| `voting_period` | 17,280 (~24 hours) | 24 hours covers all timezones, reasonable for routine proposals |
| `timelock_period` | 34,560 (~48 hours) | 48 hours gives guardian time to review |
| `proposal_threshold` | 500,000,000,000 (50,000 tokens) | 0.5% of 10M supply, meaningful stake without excluding mid-size holders |

### Security Configuration

- **Admin:** 3-of-5 multisig (2 core team members, 2 community members, 1 security advisor)
- **Guardian:** 4-of-7 multisig (core team, security advisors, external auditors)
- **Governance instances:** Single instance initially (add emergency/treasury instances if needed)

### Token Distribution (Example)

| Holder | Allocation | Governance Rights |
|--------|------------|-------------------|
| Team | 20% | Vested over 2 years |
| Community | 50% | Airdrop + liquidity mining |
| Treasury | 20% | Vested over 3 years |
| Advisors | 10% | Vested over 1 year |

### Post-Launch Review

- **Month 1:** Monitor first proposal cycle, adjust communication if needed
- **Month 3:** Review governance metrics, consider parameter changes
- **Month 6:** Full governance audit, plan for parameter upgrade if needed

---

## References

- [Governance Parameters Guide](./governance-parameters.md) - Detailed parameter selection guidance
- [Security Model](./security-model.md) - Threat assumptions and mitigations
- [Deployment Guide](./deployment.md) - Step-by-step deployment instructions
- [Protocol Integration Guide](./protocol-integration-guide.md) - SDK integration for dApps
- [Proposal Style Guide](./proposal-style-guide.md) - How to write effective proposals
