# Testnet Governance Walkthrough

This document provides a step-by-step walkthrough of creating and voting on a governance proposal on Stellar testnet. It can be used as a standalone tutorial or as a transcript for a video walkthrough.

**Prerequisites:**
- Freighter wallet extension installed
- A Stellar testnet account with XLM (get from [Stellar Laboratory faucet](https://laboratory.stellar.org/#account-creator?network=test))
- Basic understanding of web wallets and transaction signing

---

## Part 1: Connect Your Wallet

### Step 1: Open the Governance UI

Navigate to the Quorum governance UI (testnet deployment URL will be provided by the project team).

### Step 2: Click "Connect Wallet"

In the top-right corner of the page, you'll see a "Connect Wallet" button. Click it to open the Freighter wallet connection prompt.

### Step 3: Authorize Freighter

Freighter will pop up and ask for permission to connect to the site. Click "Allow" to authorize the connection.

**What happens:**
- The governance UI reads your public address from Freighter
- Your address is displayed in the top-right corner (e.g., `GABCD...XYZ`)
- You can now view proposals and your voting power

### Step 4: Check Your Voting Power

After connecting, the governance UI displays your voting power for each proposal. This is your QUORUM token balance at the proposal's snapshot ledger (not your current balance).

**Note:** If your voting power is 0, you don't hold QUORUM tokens at the snapshot. You may need to acquire tokens on testnet (check with the project team for testnet token distribution).

---

## Part 2: Create a Proposal

### Step 1: Navigate to "Create Proposal"

Click the "Create Proposal" button in the navigation bar or on the proposals list page.

### Step 2: Enter Proposal Details

Fill in the proposal form:

**Title:** A short, clear description of what the proposal does (e.g., "Update treasury management to multisig")

**Description:** A detailed explanation including:
- Background: Why is this proposal needed?
- Specification: What exactly will change?
- Rationale: Why is this the right approach?
- Risks: What could go wrong?

**Example:**
```
Title: Deploy new liquidity pool on Stellar DEX

Description:
This proposal deploys a new liquidity pool for the QUORUM-USDC pair on Stellar DEX.

Background:
Current liquidity is fragmented across multiple DEXs. Consolidating to a single pool will improve price stability and reduce slippage.

Specification:
- Deploy QUORUM-USDC pool on Stellar DEX
- Seed with 50,000 QUORUM from treasury
- Set fee tier to 0.3%

Rationale:
Stellar DEX has the highest volume and deepest liquidity in the Stellar ecosystem. Consolidating here improves capital efficiency.

Risks:
- Centralized liquidity may reduce resilience if Stellar DEX has issues
- Fee tier may need adjustment based on volume
```

### Step 3: Review and Sign

Review your proposal details, then click "Create Proposal."

Freighter will pop up and ask you to sign the transaction. Review the transaction details:
- **Function:** `create_proposal`
- **Contract:** Governance contract ID
- **Parameters:** Title, description, and your address

Click "Approve" in Freighter to sign.

**What happens:**
- The transaction is submitted to the Stellar testnet
- The governance contract records your proposal
- A snapshot ledger is set (current ledger + 1)
- The proposal enters "Pending" state, then "Active" after the voting period starts

### Step 4: Confirm Proposal Creation

After the transaction confirms, you'll be redirected to the proposal page. You should see:
- Proposal ID (e.g., #1)
- Your address as the proposer
- Voting period countdown (e.g., "23 hours 59 minutes remaining")
- Your voting power displayed above the vote buttons

---

## Part 3: Vote on a Proposal

### Step 1: Find a Proposal to Vote On

Navigate to the "Proposals" page and click on any active proposal (status: "Active").

### Step 2: Review the Proposal

Read the proposal title and description carefully. Consider:
- Do you understand what the proposal does?
- Do you agree with the rationale?
- Are the risks acceptable?

### Step 3: Check Your Voting Power

Above the vote buttons, you'll see your voting power for this proposal. This is your QUORUM token balance at the snapshot ledger.

**Example:** "Your voting power: 10,000 QUORUM"

If your voting power is 0, you cannot vote on this proposal (you didn't hold tokens at the snapshot).

### Step 4: Cast Your Vote

Choose one of three options:

- **For:** You support the proposal
- **Against:** You oppose the proposal
- **Abstain:** You don't have a strong opinion but want to signal participation

Click the button corresponding to your choice.

### Step 5: Sign the Vote Transaction

Freighter will pop up and ask you to sign the vote transaction. Review:
- **Function:** `vote`
- **Contract:** Governance contract ID
- **Parameters:** Proposal ID, your address, and your vote choice (0=Against, 1=For, 2=Abstain)

Click "Approve" in Freighter to sign.

**What happens:**
- The transaction is submitted to Stellar testnet
- The governance contract records your vote
- Your voting power is added to the corresponding tally (For, Against, or Abstain)
- The proposal page updates to show your vote

### Step 6: Confirm Your Vote

After the transaction confirms, the proposal page will show:
- Your vote highlighted (e.g., "You voted: For")
- Updated vote tallies (For, Against, Abstain)
- Updated quorum progress (total votes / quorum required)

**Note:** You can only vote once per proposal. If you change your mind, you cannot withdraw or change your vote.

---

## Part 4: Finalize a Proposal

### Step 1: Wait for Voting to End

Voting remains open for the voting period (default: 24 hours). You cannot finalize until the voting period ends.

The proposal page will show a countdown. When it reaches 0, the proposal is ready to finalize.

### Step 2: Check Quorum and Vote Distribution

Before finalizing, check:
- **Quorum reached?** Total votes (For + Against + Abstain) must meet the quorum threshold (default: 5% of supply)
- **Vote distribution:** For votes must be greater than Against votes for the proposal to pass

**Example:**
- Quorum required: 500,000 QUORUM
- Total votes: 600,000 QUORUM ✓ (quorum reached)
- For: 400,000, Against: 150,000, Abstain: 50,000 ✓ (For > Against, proposal will pass)

### Step 3: Click "Finalize"

Click the "Finalize" button on the proposal page. Anyone can finalize a proposal (not just the proposer).

### Step 4: Sign the Finalize Transaction

Freighter will pop up and ask you to sign the finalize transaction. Review:
- **Function:** `finalize`
- **Contract:** Governance contract ID
- **Parameters:** Proposal ID

Click "Approve" in Freighter to sign.

**What happens:**
- The transaction is submitted to Stellar testnet
- The governance contract calculates final vote tallies
- If quorum is reached and For > Against, the proposal moves to "Queued" status
- If quorum is not reached or Against ≥ For, the proposal moves to "Failed" status
- If queued, a timelock countdown starts (default: 12 hours)

### Step 5: Confirm Finalization

After the transaction confirms, the proposal page will show:
- Proposal status: "Queued" (if passed) or "Failed" (if rejected)
- Final vote tallies
- Timelock countdown (if queued)

---

## Part 5: Execute a Proposal (Optional)

**Note:** On-chain execution is not yet implemented in Quorum. This section describes the intended flow once execution is available.

### Step 1: Wait for Timelock to Expire

If the proposal passed and is "Queued," wait for the timelock period (default: 12 hours). The guardian multisig can veto during this window.

### Step 2: Check for Guardian Veto

Before executing, verify the proposal is still "Queued" (not "Cancelled" by guardian).

### Step 3: Click "Execute"

Click the "Execute" button on the proposal page.

### Step 4: Sign the Execute Transaction

Freighter will pop up and ask you to sign the execute transaction. Review:
- **Function:** `execute`
- **Contract:** Governance contract ID
- **Parameters:** Proposal ID

Click "Approve" in Freighter to sign.

**What happens:**
- The transaction is submitted to Stellar testnet
- The governance contract marks the proposal as "Executed"
- The proposal's on-chain actions are dispatched (e.g., parameter changes, treasury movements)

### Step 5: Confirm Execution

After the transaction confirms, the proposal page will show:
- Proposal status: "Executed"
- Execution timestamp

---

## Troubleshooting

### "No voting power" error

**Cause:** You don't hold QUORUM tokens at the proposal's snapshot ledger.

**Solution:** Acquire QUORUM tokens on testnet before the next proposal's snapshot. Tokens acquired after the snapshot do not count for that proposal.

### "Transaction failed" error

**Cause:** Multiple possible issues:
- Insufficient XLM for transaction fees
- Network congestion
- Invalid proposal parameters

**Solution:**
- Ensure your testnet account has XLM (get from faucet)
- Wait a few seconds and retry
- Check the proposal parameters match the expected format

### Proposal shows "Failed" status

**Cause:** Either quorum was not reached, or Against votes ≥ For votes.

**Solution:** Review the vote tallies. If quorum was the issue, increase community participation. If Against votes were high, revise the proposal based on feedback.

### "Already voted" error

**Cause:** You already voted on this proposal, and the voting window has closed. Each address keeps one recorded choice per proposal.

**Solution:** While voting is open you can change your choice by voting again. Once the window closes, your vote is final.

---

## Video Script (for Recording)

**[0:00-0:30] Introduction**
"Hi, I'm [name], and today I'll walk you through creating and voting on a governance proposal on Stellar testnet using Quorum. We'll cover connecting your wallet, creating a proposal, voting, and finalizing it."

**[0:30-1:30] Connect Wallet**
"First, let's connect our wallet. Click 'Connect Wallet' in the top-right corner. Freighter will pop up asking for permission—click 'Allow.' Now you can see your address displayed here. Below each proposal, you'll see your voting power, which is your QUORUM balance at the proposal's snapshot."

**[1:30-3:00] Create Proposal**
"Now let's create a proposal. Click 'Create Proposal' and fill in the title and description. I'll use a simple example: 'Update treasury management to multisig.' For the description, explain the background, what will change, why it's the right approach, and any risks. Click 'Create Proposal,' then approve the transaction in Freighter. The proposal is now created and will enter the voting period."

**[3:00-4:30] Vote on Proposal**
"Let's vote on this proposal. Navigate to the proposals page and click on the active proposal. Review the details, then check your voting power above the vote buttons. I'll vote 'For' by clicking the button. Approve the transaction in Freighter. Your vote is now recorded, and the tallies update."

**[4:30-5:30] Finalize Proposal**
"Voting remains open for 24 hours. Once the period ends, anyone can finalize the proposal. Click 'Finalize' and approve the transaction. The contract checks if quorum was reached and if For votes exceeded Against. In this case, the proposal passes and enters the 12-hour timelock."

**[5:30-6:00] Conclusion**
"That's the full flow: connect, create, vote, and finalize. After the timelock, the proposal can be executed (though execution is not yet implemented). Try it yourself on testnet, and let us know if you have questions!"

---

## Additional Resources

- [Quorum SDK](../sdk/README.md) - For programmatic proposal creation and voting
- [Governance Parameters](./governance-parameters.md) - Understanding quorum, voting periods, and timelocks
- [Proposal Style Guide](./proposal-style-guide.md) - How to write effective proposals
- [Security Model](./security-model.md) - Understanding threats and mitigations
