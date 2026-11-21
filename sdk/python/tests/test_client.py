import json
from dataclasses import asdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

import pytest
from stellar_sdk import Address, TransactionEnvelope, scval, xdr

from quorum_sdk import QuorumClient, QuorumClientConfig, SimulationError

FIXTURE = json.loads((Path(__file__).resolve().parents[2] / "test/fixtures/governance-reads.json").read_text())
NETWORK = "Test SDF Network ; September 2015"


@pytest.fixture
def rpc():
    state = {"calls": [], "reply": None}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            request = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            envelope = TransactionEnvelope.from_xdr(request["params"]["transaction"], NETWORK)
            invoke = envelope.transaction.operations[0].host_function.invoke_contract
            method = invoke.function_name.sc_symbol.decode()
            args = [scval.to_native(arg) for arg in invoke.args]
            state["calls"].append((method, args, envelope))
            reply = state["reply"]
            result = reply(method, args) if reply else {"results": [{"xdr": FIXTURE["proposal"]["xdr"]}]}
            body = json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": {"latestLedger": 1000, **result}}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    config = QuorumClientConfig(f"http://127.0.0.1:{server.server_port}", NETWORK, FIXTURE["contractId"])
    with QuorumClient(config) as client:
        yield client, state
    server.shutdown()
    server.server_close()
    thread.join()


def result(xdr):
    return {"results": [{"xdr": xdr}]}


def test_proposal_matches_typescript_fixture_and_encodes_unsigned_read(rpc):
    client, state = rpc
    proposal_id = int(FIXTURE["proposal"]["expected"]["id"])
    actual = asdict(client.get_proposal(proposal_id))
    expected = FIXTURE["proposal"]["expected"].copy()
    for field in ("id", "for_votes", "against_votes", "abstain_votes", "quorum_required"):
        expected[field] = int(expected[field])
    assert actual == expected
    method, args, envelope = state["calls"][0]
    assert (method, args) == ("get_proposal", [proposal_id])
    assert envelope.signatures == []
    assert envelope.transaction.source.account_id == "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
    invoke = envelope.transaction.operations[0].host_function.invoke_contract
    assert Address.from_xdr_sc_address(invoke.contract_address).address == FIXTURE["contractId"]
    assert invoke.args[0].type.name == "SCV_U64"


@pytest.mark.parametrize("status", FIXTURE["proposalStatuses"])
def test_every_contract_proposal_status_decodes(rpc, status):
    client, state = rpc
    value = xdr.SCVal.from_xdr(FIXTURE["proposal"]["xdr"])
    for entry in value.map.sc_map:
        if scval.to_native(entry.key) == "status":
            entry.val = scval.to_vec([scval.to_symbol(status)])
    state["reply"] = lambda _method, _args: result(value.to_xdr())
    assert client.get_proposal(1).status == status


def test_config_matches_typescript_fixture(rpc):
    client, state = rpc
    state["reply"] = lambda method, args: result(FIXTURE["config"]["xdr"])
    expected = {**FIXTURE["config"]["expected"], "proposal_threshold": int(FIXTURE["config"]["expected"]["proposal_threshold"])}
    assert asdict(client.get_config()) == expected
    assert state["calls"][0][:2] == ("get_config", [])


@pytest.mark.parametrize("vote", FIXTURE["votes"])
def test_vote_decodes_some_and_none_and_encodes_address(rpc, vote):
    client, state = rpc
    state["reply"] = lambda method, args: result(vote["xdr"])
    assert client.get_vote(7, FIXTURE["voter"]) == vote["expected"]
    method, args, _ = state["calls"][0]
    assert method == "get_vote"
    assert args[0] == 7
    assert args[1].address == FIXTURE["voter"]


def test_listing_window_and_missing_proposals(rpc):
    client, state = rpc

    def reply(method, args):
        if method == "get_proposal_count":
            return result(scval.to_uint64(4).to_xdr())
        if args[0] == 3:
            return {"error": "HostError: Error(Contract, #3)"}
        return result(FIXTURE["proposal"]["xdr"])

    state["reply"] = reply
    assert len(client.get_all_proposals(offset=1, limit=2)) == 1
    assert [(method, args) for method, args, _ in state["calls"]] == [
        ("get_proposal_count", []), ("get_proposal", [2]), ("get_proposal", [3]),
    ]
    state["calls"].clear()
    assert len(client.get_all_proposals()) == 3
    assert len(state["calls"]) == 5


def test_empty_out_of_range_and_invalid_windows(rpc):
    client, state = rpc
    assert client.get_all_proposals(limit=0) == []
    for options in ({"offset": -1}, {"limit": -1}, {"limit": 1.5}, {"offset": True}):
        with pytest.raises(ValueError):
            client.get_all_proposals(**options)
    assert not state["calls"]
    state["reply"] = lambda method, args: result(scval.to_uint64(0).to_xdr())
    assert client.get_all_proposals(offset=5) == []


def test_contract_errors_are_not_silenced(rpc):
    client, state = rpc
    state["reply"] = lambda method, args: {"error": "HostError: Error(Contract, #3)"}
    assert client.get_proposal(1) is None
    state["reply"] = lambda method, args: {"error": "HostError: Error(Contract, #2)"}
    with pytest.raises(SimulationError) as error:
        client.get_proposal(1)
    assert error.value.code == 2


@pytest.mark.parametrize("reply", [{"results": []}, result("%%%invalid-xdr%%%")])
def test_missing_or_malformed_result_fails(rpc, reply):
    client, state = rpc
    state["reply"] = lambda method, args: reply
    with pytest.raises(Exception):
        client.get_config()


def test_unknown_status_is_rejected(rpc):
    client, state = rpc
    # Reuse the valid fixture and change only its enum symbol at the XDR level.
    value = xdr.SCVal.from_xdr(FIXTURE["proposal"]["xdr"])
    for entry in value.map.sc_map:
        if scval.to_native(entry.key) == "status":
            entry.val = scval.to_vec([scval.to_symbol("Unknown")])
    state["reply"] = lambda method, args: result(value.to_xdr())
    with pytest.raises(ValueError, match="ProposalStatus"):
        client.get_proposal(1)
