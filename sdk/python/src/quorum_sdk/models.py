"""Governance values, with arbitrary-precision Python integers for u64/i128."""

from dataclasses import dataclass
from typing import Literal

ProposalStatus = Literal[
    "Active", "Failed", "Queued", "Executed", "Cancelled", "Expired", "Vetoed"
]
ProposalKind = Literal["Signaling", "Executable"]
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
    timelock_period: int
    execution_grace_period: int
    status: ProposalStatus
    metadata_uri: str
    kind: ProposalKind


@dataclass(frozen=True)
class GovernanceConfig:
    token: str
    quorum_bps: int
    voting_period: int
    timelock_period: int
    proposal_threshold: int
    admin: str


@dataclass(frozen=True)
class QuorumClientConfig:
    rpc_url: str
    network_passphrase: str
    governance_contract_id: str
