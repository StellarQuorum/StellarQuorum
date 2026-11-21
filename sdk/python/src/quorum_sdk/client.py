"""Unsigned Soroban simulations only: no keys, signing, or submission."""

import re
from typing import Any

from stellar_sdk import Account, Address, SorobanServer, TransactionBuilder, scval, xdr

from .models import (
    GovernanceConfig,
    GovernanceStats,
    Proposal,
    ProposalPhase,
    QuorumClientConfig,
    VoteSupport,
)

READ_ONLY_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
STATUSES = {"Pending", "Active", "Passed", "Failed", "Queued", "Executed", "Cancelled"}
PHASES = {
    "Pending", "Active", "Ended", "Queued", "ReadyToExecute", "Passed",
    "Executed", "Failed", "Cancelled", "Expired", "Vetoed",
}


class SimulationError(RuntimeError):
    """The RPC returned a contract simulation error, optionally with a code."""

    def __init__(self, method: str, message: str):
        super().__init__(f"Simulation of {method} failed: {message}")
        match = re.search(r"Error\(Contract,\s*#(\d+)\)", message)
        self.code = int(match.group(1)) if match else None


def _native(value: Any) -> Any:
    if isinstance(value, Address):
        return value.address
    if isinstance(value, dict):
        return {_native(key): _native(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_native(item) for item in value]
    return value


class QuorumClient:
    def __init__(self, config: QuorumClientConfig):
        self.config = config
        # Validate the contract before any network request.
        Address(config.governance_contract_id)
        self._server = SorobanServer(config.rpc_url)

    def close(self) -> None:
        self._server.close()

    def __enter__(self) -> "QuorumClient":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def _simulate(self, method: str, *args: xdr.SCVal) -> Any:
        transaction = (
            TransactionBuilder(
                source_account=Account(READ_ONLY_SOURCE, 0),
                network_passphrase=self.config.network_passphrase,
                base_fee=100,
            )
            .append_invoke_contract_function_op(
                contract_id=self.config.governance_contract_id,
                function_name=method,
                parameters=list(args),
            )
            .set_timeout(30)
            .build()
        )
        response = self._server.simulate_transaction(transaction)
        if response.error:
            raise SimulationError(method, response.error)
        if not response.results:
            raise RuntimeError(f"Simulation of {method} returned no result")
        return _native(scval.to_native(xdr.SCVal.from_xdr(response.results[0].xdr)))

    def get_proposal(self, proposal_id: int) -> Proposal | None:
        """Return a proposal, or None only for the contract's ProposalNotFound."""
        try:
            raw = self._simulate("get_proposal", scval.to_uint64(proposal_id))
        except SimulationError as error:
            if error.code == 3:
                return None
            raise
        status = raw["status"]
        if not isinstance(status, list) or len(status) != 1 or status[0] not in STATUSES:
            raise ValueError(f"Unknown ProposalStatus variant: {status!r}")
        return Proposal(**{**raw, "status": status[0]})

    def get_proposal_count(self) -> int:
        return int(self._simulate("get_proposal_count"))

    def get_all_proposals(self, *, limit: int | None = None, offset: int = 0) -> list[Proposal]:
        """Read all proposals, or the requested window; ids start at one."""
        for name, value in (("offset", offset), ("limit", limit)):
            invalid = isinstance(value, bool) or not isinstance(value, int) or value < 0
            if value is not None and invalid:
                raise ValueError(f"{name} must be a non-negative integer")
        if limit == 0:
            return []
        count = self.get_proposal_count()
        end = count if limit is None else min(count, offset + limit)
        proposals = (self.get_proposal(proposal_id) for proposal_id in range(offset + 1, end + 1))
        return [proposal for proposal in proposals if proposal is not None]

    def get_config(self) -> GovernanceConfig:
        return GovernanceConfig(**self._simulate("get_config"))

    def get_vote(self, proposal_id: int, voter: str) -> VoteSupport | None:
        """0 = Against, 1 = For, 2 = Abstain; None means no recorded vote."""
        support = self._simulate("get_vote", scval.to_uint64(proposal_id), scval.to_address(voter))
        if support is not None and (type(support) is not int or support not in (0, 1, 2)):
            raise ValueError(f"Unknown vote support: {support!r}")
        return support

    def get_proposal_phase(self, proposal_id: int) -> ProposalPhase:
        """Return the contract-derived lifecycle phase at the latest ledger."""
        raw = self._simulate("get_proposal_phase", scval.to_uint64(proposal_id))
        phase = raw[0] if isinstance(raw, list) and len(raw) == 1 else raw
        if phase not in PHASES:
            raise ValueError(f"Unknown ProposalPhase variant: {phase!r}")
        return phase

    def get_quorum_progress(self, proposal_id: int) -> int:
        """Return quorum completion in basis points, capped at 10,000."""
        progress = self._simulate("get_quorum_progress", scval.to_uint64(proposal_id))
        if type(progress) is not int or not 0 <= progress <= 10_000:
            raise ValueError(f"Invalid quorum progress: {progress!r}")
        return progress

    def get_governance_stats(self) -> GovernanceStats:
        """Return typed governance-wide proposal and vote counters."""
        raw = self._simulate("get_governance_stats")
        values = {
            field: int(raw.get(field, 0))
            for field in GovernanceStats.__dataclass_fields__
        }
        return GovernanceStats(**values)

    def get_delegate(self, account: str) -> str:
        """Return the address currently receiving this account's voting power."""
        return str(self._simulate("get_delegate", scval.to_address(account)))

    def get_past_votes(self, account: str, ledger: int) -> int:
        """Return effective delegated voting power at a historical ledger."""
        if isinstance(ledger, bool) or not isinstance(ledger, int) or not 0 <= ledger <= 0xFFFFFFFF:
            raise ValueError("ledger must be a non-negative u32")
        raw = self._simulate(
            "get_past_votes", scval.to_address(account), scval.to_uint32(ledger)
        )
        return int(raw)

    def _build_transaction(self, source: str, method: str, *args: xdr.SCVal) -> str:
        """Build and simulate a write call, returning unsigned base64 XDR."""
        source_account = self._server.load_account(source)
        transaction = (
            TransactionBuilder(
                source_account=source_account,
                network_passphrase=self.config.network_passphrase,
                base_fee=100,
            )
            .append_invoke_contract_function_op(
                contract_id=self.config.governance_contract_id,
                function_name=method,
                parameters=list(args),
            )
            .set_timeout(30)
            .build()
        )
        return self._server.prepare_transaction(transaction).to_xdr()

    def build_create_proposal(
        self,
        proposer: str,
        title: str,
        description: str,
        metadata_uri: str = "",
        *,
        source: str | None = None,
    ) -> str:
        """Build unsigned XDR for create_proposal; proposer authorizes the call."""
        return self._build_transaction(
            source or proposer, "create_proposal", scval.to_address(proposer),
            scval.to_string(title), scval.to_string(description), scval.to_string(metadata_uri),
        )

    def build_vote(
        self, voter: str, proposal_id: int, support: VoteSupport, *, source: str | None = None
    ) -> str:
        """Build unsigned XDR for vote; support is 0=Against, 1=For, 2=Abstain."""
        if type(support) is not int or support not in (0, 1, 2):
            raise ValueError("support must be 0 (Against), 1 (For), or 2 (Abstain)")
        return self._build_transaction(
            source or voter,
            "vote",
            scval.to_address(voter),
            scval.to_uint64(proposal_id),
            scval.to_uint32(support),
        )

    def build_finalize(self, source: str, proposal_id: int) -> str:
        """Build unsigned XDR for permissionless finalize; source pays the fee."""
        return self._build_transaction(source, "finalize", scval.to_uint64(proposal_id))

    def build_execute(self, source: str, proposal_id: int) -> str:
        """Build unsigned XDR for execute; source is executor and fee payer."""
        return self._build_transaction(
            source, "execute", scval.to_address(source), scval.to_uint64(proposal_id)
        )
