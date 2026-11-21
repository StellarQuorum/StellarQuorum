# Incident Response Runbook

This runbook provides step-by-step guidance for guardians and operators responding to governance attacks or emergencies in Quorum. It covers detection, veto/pause invocation, communication, and safe recovery.

---

## Scope

This runbook applies to:
- **Guardian multisig signers** — trusted operators with veto authority
- **Admin key holders** — operators with pause and key-rotation authority
- **Proposers** — the only party that can cancel a proposal

**Emergency tools available:**
- Guardian veto (timelock window only)
- Contract pause (admin or guardian)
- Proposer cancellation (only the address that opened the proposal)

---

## 1. Detecting an Attack

### Early Warning Signs

Monitor these channels and signals for anomalies:

| Signal | What to Look For | Tool |
|--------|------------------|------|
| **Governance events** | Suspicious proposals, unusual voting patterns | `proposal_created`, `vote_cast` events via indexer |
| **Token flows** | Large sudden transfers, concentration changes | Token transfer events, balance snapshots |
| **Social chatter** | Community reports of phishing, compromise | Discord, X, GitHub Issues |
| **Off-chain signals** | Developer key compromise, repository breach | Security team intel, 2FA alerts |

### Specific Attack Indicators

**Flash-loan attempt:**
- Large token borrow followed by immediate proposal creation
- Votes cast from addresses that held zero tokens at the snapshot ledger
- *Mitigation:* Contract already blocks this by reading snapshot balances

**Governance takeover:**
- Proposals to transfer admin rights, mint tokens, or change core parameters
- Unusually high participation from new/unknown addresses
- Coordinated voting block with similar timing patterns

**Social engineering/phishing:**
- Users reporting signing unexpected transactions
- Fake governance URLs mimicking the official frontend
- Delegations to unknown addresses

**Admin key compromise:**
- Governance is paused without explanation
- Admin or guardian rotation is attempted unexpectedly
- Admin key used from unexpected IP/location

### Monitoring Setup

Set up automated alerts for:
- Proposal creation with titles containing "admin", "mint", "transfer", "pause"
- Any proposal reaching > 50% "For" votes within 1 hour of creation
- Token transfers > 5% of total supply in a single transaction
- Admin key usage (pause/unpause and rotation events)

---

## 2. Invoking Veto or Pause

### Guardian Veto (Timelock Window)

**When to use:**
- A malicious proposal has passed and is queued for execution
- The proposal is within the timelock window (default 48 hours)
- The threat is time-sensitive and cannot wait for token holder response

**Steps:**

1. **Verify the threat**
   - Confirm the proposal ID and queue_ledger
   - Read the proposal on-chain to verify content
   - Cross-check with community reports
   - If uncertain, pause and convene the guardian group

2. **Convene guardian multisig**
   - Trigger your multisig's emergency communication channel (secure chat, signal group, etc.)
   - Share proposal details and threat assessment
   - Get required threshold of signers (e.g., 3-of-5) to agree on veto

3. **Execute veto transaction**
   - Build the veto transaction using the SDK:
     ```typescript
     const client = new QuorumClient({ rpcUrl, networkPassphrase });
     const vetoTx = await client.buildVetoProposal(proposalId);
     ```
   - Each guardian signs with their wallet
   - Submit the signed transaction to the Stellar RPC
   - Verify the proposal status changes to `Vetoed` or `Failed`

4. **Document the action**
   - Record the veto in your incident log
   - Note the time, proposal ID, signers, and rationale
   - Save transaction hash for audit trail

### Proposal Cancellation (Proposer Only)

**Who can use it:** only the address that opened the proposal. The admin has no
cancellation power (#425), so operators cannot use cancellation as an emergency
tool.

**When the proposer may use it:**
- The proposal was opened in error, or its content is wrong
- Voting is still open (`end_ledger` has not passed)

A cancellation before `start_ledger` refunds the deposit; a cancellation after
voting starts forfeits it. If an operator needs to neutralize a malicious live
proposal it cannot cancel, the options are to pause the contract and let the
voting window expire, or to let the proposal queue and have the guardian veto
it.

### Emergency Pause (Via Proposal)

**If an emergency pause function exists in the contract (e.g., after issue #53 lands):**

**When to use:**
- The governance system itself is under attack
- Multiple malicious proposals are being created rapidly
- A broader pause is needed to assess the situation

**Steps:**

1. **Create emergency pause proposal**
   - Title: "EMERGENCY: Pause governance pending security review"
   - Description: Explain the incident and need for pause
   - Set voting period to minimum (e.g., 1 hour) if allowed

2. **Rapid vote mobilization**
   - Contact known large token holders off-chain
   - Use social channels to rally community votes
   - Guardian should vote FOR immediately

3. **Execute pause**
   - Once passed, wait for timelock
   - Execute the pause transaction
   - Verify governance functions are disabled

4. **Resume governance**
   - Create a "Resume governance" proposal only after:
     - Root cause is identified and fixed
     - Token holders are informed
     - Guardian group approves resumption

---

## 3. Communicating to Token Holders

### Immediate Response (Within 1 Hour)

**Channels:**
- Discord announcements channel
- X (Twitter) account
- GitHub Discussions (if applicable)
- Email to token holder mailing list (if exists)

**Template:**

```
🚨 INCIDENT REPORT: Proposal #[ID] Vetoed

We have vetoed proposal #[ID] titled "[Title]" due to [reason].

What happened:
- [Brief, factual description of the threat]

Why we acted:
- [Explanation of the attack vector or risk]

What this means:
- The proposal will not execute
- Your tokens are safe
- Governance continues normally

Next steps:
- We will publish a full post-incident review within 24 hours
- Questions? Join Discord: [link]

Transaction hash: [hash]
Guardian signers: [list]
```

### Follow-up Communication (Within 24 Hours)

**Post-incident review should include:**
- Timeline of events (detection → action → resolution)
- Evidence of the attack (screenshots, on-chain data)
- Root cause analysis
- Lessons learned
- Preventive measures for the future

**Publish to:**
- GitHub repository (as a new issue or discussion)
- Discord forum
- Governance documentation (update relevant sections)

### Handling Disagreement

If token holders disagree with a veto or cancellation:

1. **Listen to community feedback**
   - Monitor Discord, GitHub, and social media
   - Acknowledge valid concerns
   - Be transparent about the decision process

2. **Explain the trade-off**
   - Guardian veto is a safety net, not democratic control
   - It is designed to prevent irreversible damage
   - The alternative (no veto) would expose the protocol to attacks

3. **If abuse is suspected**
   - If the guardian vetoes legitimate proposals repeatedly, the community can:
     - Propose to remove the guardian role (if contract allows)
     - Request guardian multisig signers to step down
     - Fork the protocol with different security assumptions

---

## 4. Safely Resuming Operations

### After a Veto

**No special action required** — governance continues normally. However:

1. **Review the attacked proposal**
   - Was it a one-off attempt or part of a broader campaign?
   - Are there similar proposals still active?
   - Should the proposer be blacklisted or penalized?

2. **Strengthen monitoring**
   - Add new alerts based on attack patterns observed
   - Review guardian response time and process
   - Update this runbook with lessons learned

### After a Cancellation

Similar to veto, but consider:

1. **Proposer communication**
   - If the proposer acted in good faith, explain why the proposal was cancelled
   - Offer guidance on how to reframe it legitimately
   - If malicious, consider banning the address from future proposals (if contract allows)

2. **Policy review**
   - Should the proposal threshold be increased?
   - Should certain proposal types be prohibited?
   - Discuss with community via governance proposal

### After an Emergency Pause

**Resume only after thorough review:**

1. **Security audit**
   - Verify the vulnerability is patched
   - Confirm no backdoors or lingering issues
   - Run full test suite and contract verification

2. **Community approval**
   - Create a "Resume governance" proposal
   - Set a longer voting period (e.g., 48 hours) to ensure broad consensus
   - Include the post-incident review in the proposal description

3. **Gradual reactivation**
   - Start with read-only functions enabled
   - Re-enable proposal creation after 24 hours
   - Re-enable execution after another 24 hours
   - Monitor closely for resumed attacks

4. **Update parameters (if needed)**
   - Consider increasing timelock period
   - Consider increasing proposal threshold
   - Consider adding new guardian signers

---

## 5. Guardian Best Practices

### Multisig Configuration

| Parameter | Recommendation | Rationale |
|-----------|----------------|-----------|
| Signers | 3-of-5 or 4-of-7 | Balance between security and availability |
| Key type | Hardware wallets (Ledger, Trezor) | Reduces phishing risk |
| Geographic distribution | Spread across regions | Reduces single-point-of-failure (e.g., natural disaster) |
| Key holders | Trusted security professionals, not core team | Separation of duties |

### Operational Security

- **Never share private keys** — use multisig or hardware wallets
- **Use secure communication** — Signal, Keybase, or encrypted email for coordination
- **Rotate signers periodically** — every 6-12 months, or after any incident
- **Document everything** — every veto should have a clear audit trail
- **Test the veto process** — run a drill on testnet before mainnet deployment

### Decision Framework

When deciding whether to veto, ask:

1. **Is the threat time-sensitive?** If not, let token holders vote it down
2. **Is the damage irreversible?** If yes, veto is justified
3. **Is the proposal clearly malicious?** If ambiguous, discuss with the full guardian group
4. **Have we informed the community?** Transparency builds trust

---

## 6. Contact Information

**Fill in for your deployment:**

| Role | Contact | Backup |
|------|---------|--------|
| Guardian multisig coordinator | [email/Signal] | [backup] |
| Admin key holder | [email/Signal] | [backup] |
| Security lead | [email/Signal] | [backup] |
| Community manager | [Discord/X handle] | [backup] |

**Emergency channels:**
- Discord: [link]
- Signal group: [link]
- Email: [address]

---

## Appendix: Common Scenarios

### Scenario A: Rushed Malicious Proposal

**Situation:** A proposal to "transfer admin to attacker address" passes with 51% votes in 1 hour.

**Response:**
1. Guardian detects via automated alert
2. Guardian convenes multisig (3-of-5)
3. Guardian vetoes during timelock (48 hours remaining)
4. Announce veto on Discord and X
5. Investigate voting patterns (was it a whale or coordinated attack?)
6. Consider increasing proposal threshold to prevent future attempts

### Scenario B: Admin Key Compromise

**Situation:** The admin key pauses governance without explanation, or attempts to rotate the admin to an attacker address.

**Response:**
1. **Do not use the compromised admin key**
2. Guardian vetoes all malicious proposals during timelock
3. Convene emergency meeting with core team
4. Execute two-step admin transfer (see issue #87) to move admin to a new multisig
5. Rotate all guardian keys if they may be linked
6. Publish full incident report

### Scenario C: Social Engineering Attack

**Situation:** Users report signing a "vote" transaction that actually delegated all their tokens to an attacker.

**Response:**
1. Guardian monitors for sudden voting power shifts
2. If attacker proposes malicious actions, veto immediately
3. Warn community on all channels to stop signing
4. Coordinate with frontend team to add warnings
5. Consider emergency pause if attack is widespread
6. Update documentation with phishing examples

---

**Last updated:** 2025-01-XX
**Version:** 1.0
