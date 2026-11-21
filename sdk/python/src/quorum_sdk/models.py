"""Governance values, with arbitrary-precision Python integers for u64/i128."""

from dataclasses import dataclass
from typing import Literal

ProposalStatus = Literal["Pending", "Active", "Passed", "Failed", "Queued", "Executed", "Cancelled"]
ProposalPhase = Literal[
    "Pending", "Active", "Ended", "Queued", "ReadyToExecute", "Passed",
    "Executed", "Failed", "Cancelled", "Expired", "Vetoed",
]
VoteSupport = Literal[0, 1, 2]


@dataclass(frozen=True)
class Proposal:
    id: int
    proposer: str
    title: str
    description: str
    for_votes: int
    against_votes: int
    abstain_votes: int
    snapshot_ledger: int
    start_ledger: int
    end_ledger: int
    queue_ledger: int
    quorum_required: int
    status: ProposalStatus


@dataclass(frozen=True)
class GovernanceConfig:
    token: str
    quorum_bps: int
    voting_period: int
    timelock_period: int
    proposal_threshold: int
    admin: str


@dataclass(frozen=True)
class GovernanceStats:
    total_proposals: int
    active_proposals: int
    queued_proposals: int
    executed_proposals: int
    failed_proposals: int
    cancelled_proposals: int
    expired_proposals: int
    vetoed_proposals: int


@dataclass(frozen=True)
class QuorumClientConfig:
    rpc_url: str
    network_passphrase: str
    governance_contract_id: str
