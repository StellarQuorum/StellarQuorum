"""Unsigned Soroban simulations only: no keys, signing, or submission."""

import re
from typing import Any

from stellar_sdk import Account, Address, SorobanServer, TransactionBuilder, scval, xdr

from .models import GovernanceConfig, Proposal, QuorumClientConfig, VoteSupport

READ_ONLY_SOURCE = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
STATUSES = {"Active", "Failed", "Queued", "Executed", "Cancelled", "Expired", "Vetoed"}
PROPOSAL_KINDS = {"Signaling", "Executable"}


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
        # Older deployed contracts and the shared parity fixture do not yet
        # expose the proposal metadata fields added to the current ABI.
        raw.setdefault("timelock_period", 0)
        raw.setdefault("execution_grace_period", 0)
        raw.setdefault("metadata_uri", "")
        raw.setdefault("kind", ["Executable"])
        status = raw["status"]
        if not isinstance(status, list) or len(status) != 1 or status[0] not in STATUSES:
            raise ValueError(f"Unknown ProposalStatus variant: {status!r}")
        kind = raw["kind"]
        if not isinstance(kind, list) or len(kind) != 1 or kind[0] not in PROPOSAL_KINDS:
            raise ValueError(f"Unknown ProposalKind variant: {kind!r}")
        return Proposal(**{**raw, "status": status[0], "kind": kind[0]})

    def get_proposal_count(self) -> int:
        return int(self._simulate("get_proposal_count"))

    def get_all_proposals(self, *, limit: int | None = None, offset: int = 0) -> list[Proposal]:
        """Read all proposals, or the requested window; ids start at one."""
        for name, value in (("offset", offset), ("limit", limit)):
            if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value < 0):
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
