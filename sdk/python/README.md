# StellarQuorum Python SDK

Read-only governance queries for Python 3.10+. The package uses the official
Stellar Python SDK for Soroban transaction encoding and XDR decoding. No
wallet, secret key, funded account, or signing is needed. Transactions are
simulated only; this package does not submit transactions.

## Install from source

This package is not published to PyPI. From the repository root:

```bash
python -m pip install ./sdk/python
```

Or install directly from Git (pin a reviewed tag or commit for production):

```bash
python -m pip install 'git+https://github.com/StellarQuorum/StellarQuorum.git#subdirectory=sdk/python'
```

The Git installation requires a revision containing this package. While the
pull request is open, install from its checked-out source directory.

## Usage

```python
from quorum_sdk import QuorumClient, QuorumClientConfig

config = QuorumClientConfig(
    rpc_url="https://soroban-testnet.stellar.org",
    network_passphrase="Test SDF Network ; September 2015",
    governance_contract_id="C...",  # replace with your deployed contract
)

with QuorumClient(config) as client:
    governance = client.get_config()
    print(governance.quorum_bps, governance.proposal_threshold)

    proposal = client.get_proposal(1)
    if proposal is not None:
        print(proposal.title, proposal.status, proposal.for_votes)

    page = client.get_all_proposals(offset=0, limit=50)
    all_proposals = client.get_all_proposals()

    support = client.get_vote(1, "G...")  # replace with a voter address
    # None = no vote; 0 = Against; 1 = For; 2 = Abstain.
    print(support)
```

`Proposal` and `GovernanceConfig` are frozen dataclasses with the TypeScript
SDK's fields in snake_case, including proposal timelock, execution grace,
metadata URI, and kind. Proposal statuses are `Active`, `Failed`, `Queued`,
`Executed`, `Cancelled`, `Expired`, or `Vetoed`; proposal kinds are
`Signaling` or `Executable`. All u64/i128 values use arbitrary-precision
Python `int`. Use `dataclasses.asdict()` to convert a result to a dictionary.

`get_proposal()` returns `None` only for contract error 3 (ProposalNotFound).
Other simulation failures raise `SimulationError`, whose `code` exposes the
contract error number when present. Transport and invalid-XDR errors propagate.
`get_all_proposals()` reads the count then simulates each requested proposal
in order, omitting deleted/missing proposals. `get_proposal_count()` is also
available. Reads are synchronous, uncached, and do not use JSON-RPC batching.
Contract initialization and write transaction building remain in the TypeScript
SDK. Call `close()` when done, or use the context manager above.

## Contributor checks

From the repository root:

```bash
python -m pip install -e './sdk/python[test]'
python -m pytest sdk/python/tests
python -m pip install build
python -m build sdk/python
```

Tests run offline against an HTTP mock provider and share the exact base64
XDR fixtures in `sdk/test/fixtures/governance-reads.json` with the TypeScript
tests, including u64/i128 values above JavaScript's safe integer range.

## Development

Set up a virtual environment and install the package in editable mode with its
test extra, from the repository root:

```bash
python -m venv .venv && . .venv/bin/activate
python -m pip install -e './sdk/python[test]'
python -m pytest sdk/python/tests
```

The tests need no network: they use an HTTP mock provider. CI runs the same
commands on Python 3.10 in the `sdk-python` job of `.github/workflows/ci.yml`,
then builds the source and wheel distributions with `python -m build sdk/python`.

### Parity with the TypeScript SDK

Parity is checked through shared fixtures, not by calling the TypeScript code.
`sdk/test/fixtures/governance-reads.json` holds the base64 XDR the contract
returns for each read, together with the decoded values. Both the TypeScript test
`sdk/test/python-parity.test.ts` and `sdk/python/tests/test_client.py` decode the same fixtures and must
produce the same values. When a contract read or type changes, update that
fixture and both SDKs in the same pull request.

## Releases

The Python SDK is **not published to PyPI**, and no workflow uploads it. The
version in `pyproject.toml` is bumped by hand alongside the TypeScript SDK.
Install it from source or from a pinned Git tag as described above. Publishing
to PyPI would need a project owner, a trusted-publisher or token secret, and a
release job; until then, [docs/publishing.md](../../docs/publishing.md) lists
only the npm package.
