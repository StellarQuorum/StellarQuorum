# Admin Key Management Guide

The admin key in Quorum's governance and token contracts holds significant power. This guide explains how to custody it securely and rotate it safely.

---

## Overview

### What the Admin Key Controls

**Governance contract admin (`Config.admin`):**
- Pause and unpause the contract
- Rotate the admin and guardian, and set the proposal deposit, proposer cooldown and action allowlist
- Deploy the initial contracts

The admin cannot cancel proposals: cancellation is proposer-only (#425).

**Token contract admin (`Admin`):**
- Mint new tokens
- Burn tokens
- Transfer admin rights
- Approve arbitrary allowances

### Risk Summary

| Risk | Impact | Likelihood |
|------|--------|------------|
| Key theft via phishing | Critical (minting, pausing governance) | Medium |
| Key holder acts maliciously | Critical (token inflation, governance manipulation) | Low (if vetted) |
| Key loss | High (cannot deploy or rotate admin) | Low (with proper backup) |

**⚠️ Critical Warning:** A single EOA (Externally Owned Account) admin key is a glaring single point of failure. **Never use a single EOA for production deployments.**

---

## Recommended Custody Models

### Option 1: Multisig Wallet (Recommended)

**Configuration:**
- 3-of-5 or 4-of-7 signers
- Hardware wallets for each signer (Ledger, Trezor)
- Geographic distribution of signers
- Trusted security professionals or DAO members as signers

**Pros:**
- No single point of failure
- Requires consensus for sensitive actions
- Reduces phishing risk (attacker must compromise multiple keys)

**Cons:**
- Slower to execute actions (requires coordination)
- More complex setup and maintenance

**Implementation:**
```bash
# Example: Using Stellar multisig
stellar keys address signer1
stellar keys address signer2
stellar keys address signer3

# Create 2-of-3 multisig
stellar transaction create \
  --source admin_multisig \
  --signer signer1 \
  --signer signer2 \
  --signer signer3 \
  --threshold 2
```

### Option 2: Hardware-Backed Single Key (Acceptable for Small Deployments)

**Configuration:**
- Single hardware wallet (Ledger, Trezor)
- Secure physical storage (safe deposit box, secure facility)
- No cloud backups or shared secrets

**Pros:**
- Simple to operate
- Fast execution
- Hardware wallets resist phishing

**Cons:**
- Single point of failure
- Key loss is catastrophic
- No consensus mechanism

**When to use:**
- Testnet deployments
- Small-scale pilot projects
- Temporary during migration to multisig

### Option 3: Custodial Service (Enterprise Only)

**Configuration:**
- Professional custody provider (Fireblocks, Anchorage, etc.)
- Multi-party computation (MPC) or HSM-backed keys
- Policy-based approvals

**Pros:**
- Enterprise-grade security
- Insurance coverage
- Institutional compliance

**Cons:**
- Costly
- Centralized counterparty risk
- May not align with decentralized ethos

---

## Admin Rotation Procedure

### Safe Admin Transfer (Two-Step Process)

Quorum implements a two-step admin transfer (closed issue #87) to prevent accidental or malicious admin changes. **Always use this method** to rotate custody.

#### Step 1: Initiate Transfer

The current admin calls `transfer_admin` to designate a new admin. This does not immediately transfer power — it only sets a `pending_admin`.

```typescript
const client = new QuorumClient({ rpcUrl, networkPassphrase });
const transferTx = await client.buildTransferAdmin(newAdminAddress);
// Sign with current admin key
await client.submitTransaction(transferTx);
```

**Verification:**
```typescript
const pendingAdmin = await client.getPendingAdmin();
console.log('Pending admin:', pendingAdmin); // Should be newAdminAddress
```

#### Step 2: Accept Transfer

The new admin calls `accept_admin` to complete the transfer. This requires the new admin's signature, confirming they control the address.

```typescript
const acceptTx = await client.buildAcceptAdmin();
// Sign with new admin key
await client.submitTransaction(acceptTx);
```

**Verification:**
```typescript
const currentAdmin = await client.getAdmin();
console.log('Current admin:', currentAdmin); // Should be newAdminAddress
```

### When to Rotate Admin

Rotate the admin key in these situations:

| Scenario | Action |
|----------|--------|
| Key holder leaves the project | Initiate transfer to new multisig or replacement signer |
| Suspected key compromise | Immediate transfer to new multisig (emergency) |
| Moving from testnet to mainnet | Transfer from single EOA to multisig |
| Regular security hygiene | Every 6-12 months, or after major incident |
| Multisig signer rotation | Update multisig configuration, then transfer to new address |

### Rotation Checklist

Before initiating a transfer:

- [ ] New admin address is secure (multisig or hardware wallet)
- [ ] New admin signers are vetted and have signed agreements
- [ ] Current admin has backed up their key (if needed for rollback)
- [ ] Community is informed (for governance contract admin)
- [ ] Test the transfer on testnet first

After completing a transfer:

- [ ] Verify the new admin is in control (call `get_admin`)
- [ ] Securely destroy or deprecate the old admin key
- [ ] Update documentation and contact information
- [ ] Monitor for any unexpected admin activity

---

## Deployment Best Practices

### Initial Setup

**For governance contract:**
```typescript
// Initialize with multisig as admin
const adminMultisig = "G..."; // 3-of-5 multisig address
await client.initialize({
  token: tokenAddress,
  admin: adminMultisig,
  quorum_bps: 400, // 4%
  voting_period: 17280, // 24 hours
  timelock_period: 34560, // 48 hours
  proposal_threshold: 50000 // 50,000 tokens
});
```

**For token contract:**
```typescript
// Initialize with multisig as admin
const adminMultisig = "G..."; // Same or different multisig
await tokenClient.initialize({
  admin: adminMultisig,
  name: "Quorum Governance Token",
  symbol: "QUORUM",
  decimals: 7,
  initial_supply: 1000000000 // 1 billion tokens
});
```

### Testnet to Mainnet Migration

1. **Deploy on testnet with single EOA admin** (for development speed)
2. **Deploy on mainnet with multisig admin** (from day one)
3. **Never reuse testnet admin keys on mainnet**

### Key Generation

**Generate keys securely:**
```bash
# Use Stellar CLI with hardware wallet
stellar keys generate --ledger

# Or use Freighter wallet with hardware device
# Never generate keys on cloud VMs or shared computers
```

**Key storage:**
- Hardware wallet: Keep device in secure location
- Paper backup: Store in safe deposit box, encrypted vault
- Digital backup: Encrypted with strong passphrase, air-gapped storage
- **Never** store keys in:
  - GitHub repositories
  - Slack/Discord messages
  - Unencrypted cloud storage
  - Email attachments

---

## Emergency Procedures

### Admin Key Compromise

If the admin key is stolen or compromised:

1. **Do not use the compromised key** — it may trigger unintended actions
2. **If guardian multisig exists:**
   - Guardian can veto malicious proposals during timelock
   - This buys time to rotate the admin
3. **Initiate emergency transfer:**
   - Use the compromised key **one last time** to initiate transfer to a new multisig
   - This is risky but necessary if no guardian exists
   - The new admin must accept quickly
4. **Notify community immediately**
5. **Investigate the breach** — how was the key compromised?
6. **Rotate all related keys** — guardian, signers, deployer keys

### Admin Key Loss

If the admin key is lost and cannot be recovered:

1. **Check for pending admin transfer** — if a transfer was initiated but not accepted, the pending admin can still accept
2. **If no pending transfer exists:**
   - The contract is permanently locked
   - Governance continues (voting, execution) but admin functions are lost
   - Consider migrating to a new contract instance
3. **Prevention:** Always have:
   - Multiple secure backups
   - A multisig with multiple signers
   - A documented recovery plan

---

## Governance vs. Token Admin Separation

### Should They Be the Same?

**Recommendation:** Use different multisigs for governance and token admin if possible.

| Approach | Pros | Cons |
|----------|------|------|
| Same multisig | Simpler coordination | Single point of failure |
| Different multisigs | Separation of concerns | More complex to coordinate |

**If using different multisigs:**
- Governance admin: DAO members, community representatives
- Token admin: Treasury managers, core team (if minting is needed)
- Ensure both groups have clear governance processes

**Governance Self-Admin Re-entry Limitation:** Soroban does not allow a contract to call itself while it is already executing. If a proposal action targets the governance contract and attempts to call `set_guardian()` or `accept_admin()`, the re-entry will be rejected at execution time. This means the recommended setup of making the governance contract its own admin cannot work through proposal actions - those actions will fail. Admin changes should be made through the two-step `transfer_admin()` / `accept_admin()` flow instead.

### Token Minting Considerations

The token admin can mint tokens, which is a powerful economic lever. Consider:

- **Disable minting after initial deployment** by revoking admin or transferring to a dead address
- **Use timelocked minting** — require a governance proposal to approve minting
- **Limit minting capacity** — cap total supply or add minting caps
- **Transparent minting** — all mints should be announced and justified

---

## Audit and Monitoring

### Regular Audits

Perform these checks quarterly:

- [ ] Verify admin key is in expected address (multisig, not EOA)
- [ ] Confirm multisig signers are still active and trusted
- [ ] Review admin activity logs (pause/unpause, admin rotations, mints, burns)
- [ ] Test admin key access (can you still sign transactions?)
- [ ] Update documentation if signers or procedures changed

### Monitoring

Set up alerts for:
- Admin key usage (any transaction signed by admin)
- Admin transfer initiated (`transfer_admin` event)
- Pending admin changes
- Unexpected minting or burning

```typescript
// Example: Monitor admin events
client.subscribeToEvents('admin_transferred', (event) => {
  console.log('Admin transferred:', event);
  alertSecurityTeam(event);
});
```

---

## Community Transparency

### What to Disclose

For decentralized protocols, disclose:

- **Who holds the admin key** (multisig members, institution)
- **What the admin can do** (refer to this guide)
- **When the admin was last used** (activity log)
- **How admin decisions are made** (multisig voting process, policy)

### Governance Proposals

For any admin action that affects the community, consider:

- Creating a governance proposal to ratify the action
- Publishing a justification document
- Seeking community feedback before acting
- Following the incident response runbook for emergencies

---

## Legal and Compliance Considerations

### For DAOs

- Admin key holders may have fiduciary duties
- Document decision-making processes
- Consider insurance for key compromise
- Consult legal counsel about liability

### For Registered Entities

- Admin key usage may require board approval
- Maintain audit trails for regulators
- Implement separation of duties
- Follow internal controls frameworks (SOC 2, ISO 27001)

---

## References

- [Security Model](security-model.md) — threat model and mitigations
- [Incident Response Runbook](incident-response.md) — emergency procedures
- [Architecture](architecture.md) — contract design and admin capabilities
- Issue #87 — two-step admin transfer implementation

---

**Last updated:** 2025-01-XX
**Version:** 1.0
