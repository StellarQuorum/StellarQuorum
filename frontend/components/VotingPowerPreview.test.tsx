import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import VotingPowerPreview from "./VotingPowerPreview";
import { WalletContext } from "./WalletProvider";
import { TOKEN_DECIMALS } from "@/lib/config";
import { getVotingPower, unitsOf, ZERO } from "../lib/voting-power";
import { describeVisual } from "@/test/visual";

// The preview exists because a vote is weighted at the proposal's snapshot
// ledger, not at the voter's current balance, and that difference is invisible
// until the vote is signed. The baselines below cover the states a voter has to
// be able to tell apart beforehand: the weight they get, that a wallet balance
// is not that weight, and that zero weight is a rejection the contract returns.
jest.mock("../lib/voting-power", () => ({
  ...jest.requireActual("../lib/voting-power"),
  getVotingPower: jest.fn(),
}));

const read = getVotingPower as jest.MockedFunction<typeof getVotingPower>;

const SNAPSHOT_LEDGER = 61_284_512;
const VOTER = "GABCDEFGHIJKLMNOPQRSTUVWXYZ3XZK";

/** 2,500 QUORUM at the snapshot, unchanged since. */
const HELD = { snapshot: unitsOf(2_500), current: unitsOf(2_500), decimals: TOKEN_DECIMALS };

function withWallet(children: ReactNode, address: string | null = VOTER) {
  return (
    <WalletContext.Provider
      value={{
        address,
        pending: false,
        error: null,
              connect: jest.fn(),
        disconnect: jest.fn(),
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

function renderPreview(power = HELD, address: string | null = VOTER) {
  read.mockResolvedValue(power);
  return render(withWallet(<VotingPowerPreview snapshotLedger={SNAPSHOT_LEDGER} />, address));
}

afterEach(() => read.mockReset());

describe("VotingPowerPreview", () => {
  it("prompts for a wallet when none is connected, and reads nothing", () => {
    const { container } = renderPreview(HELD, null);
    expect(screen.getByText(/connect your wallet/i)).toBeInTheDocument();
    expect(describeVisual(container.firstChild)).toMatchSnapshot();
    expect(read).not.toHaveBeenCalled();
  });

  it("matches the visual baseline when the snapshot balance is the current balance", async () => {
    const { container } = renderPreview();
    await screen.findByText(/you will vote with/i);
    expect(describeVisual(container.firstChild)).toMatchSnapshot();
  });

  it("matches the visual baseline when the wallet holds more than the ballot counts", async () => {
    // Bought after the proposal opened: the extra balance is not weighted.
    const { container } = renderPreview({ ...HELD, current: unitsOf(4_000) });
    await screen.findByText(/you will vote with/i);
    expect(describeVisual(container.firstChild)).toMatchSnapshot();
  });

  it("names the weight and the ledger it is read at", async () => {
    renderPreview();
    await screen.findByText(/you will vote with/i);

    // The weight, in tokens rather than raw token units.
    expect(screen.getByText("2,500")).toBeInTheDocument();
    // The ledger that decides the weight, so the number can be checked.
    expect(screen.getByText("#61,284,512")).toBeInTheDocument();
    expect(read).toHaveBeenCalledWith(VOTER, SNAPSHOT_LEDGER);
  });

  it("appears before the vote buttons, and needs no signature to render", async () => {
    read.mockResolvedValue({ snapshot: ZERO, current: ZERO, decimals: TOKEN_DECIMALS });
    const { container } = render(
      withWallet(
        <>
          <VotingPowerPreview snapshotLedger={SNAPSHOT_LEDGER} />
          <button>Vote For</button>
        </>,
      ),
    );
    await screen.findByText(/no voting power on this proposal/i);

    // Reading the weight is a contract call, not a signature: nothing is asked
    // of the wallet, and the result is on screen before the button it qualifies.
    const weight = container.firstChild!;
    const vote = screen.getByRole("button", { name: "Vote For" });
    expect(weight.compareDocumentPosition(vote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("explains a zero weight instead of only displaying it", async () => {
    const { container } = renderPreview({ snapshot: ZERO, current: ZERO, decimals: TOKEN_DECIMALS });
    await screen.findByText(/no voting power on this proposal/i);
    expect(describeVisual(container.firstChild)).toMatchSnapshot();

    // The ledger that decided it, what the contract does, and by what name.
    expect(screen.getAllByText("#61,284,512").length).toBeGreaterThan(0);
    expect(screen.getByText(/balance at snapshot ledger/i)).toBeInTheDocument();
    expect(screen.getByText(/rejects a vote from this address/i)).toBeInTheDocument();
    expect(screen.getByText("NoVotingPower")).toBeInTheDocument();
  });

  it("tells a late buyer that tokens bought after the snapshot do not count", async () => {
    renderPreview({ snapshot: ZERO, current: unitsOf(4_000), decimals: TOKEN_DECIMALS });
    await screen.findByText(/no voting power on this proposal/i);

    expect(screen.getByText(/holds 4,000 QUORUM now/i)).toBeInTheDocument();
    expect(screen.getByText(/after ledger/i)).toBeInTheDocument();
  });

  it("omits the balance comparison when there is nothing to compare", async () => {
    renderPreview();
    await screen.findByText(/you will vote with/i);
    expect(screen.queryByText(/the difference is not counted/i)).not.toBeInTheDocument();
  });

  it("re-reads the weight when the connected wallet changes", async () => {
    const { rerender } = renderPreview();
    await screen.findByText(/you will vote with/i);

    const other = "GOTHERWALLETADDRESS0000000000003XZK";
    read.mockResolvedValue({ snapshot: ZERO, current: ZERO, decimals: TOKEN_DECIMALS });
    rerender(withWallet(<VotingPowerPreview snapshotLedger={SNAPSHOT_LEDGER} />, other));

    await waitFor(() => expect(screen.getByText(/no voting power on this proposal/i)).toBeInTheDocument());
    expect(read).toHaveBeenLastCalledWith(other, SNAPSHOT_LEDGER);
  });

  it("distinguishes a failed read from no voting power", async () => {
    read.mockRejectedValue(new Error("RPC unavailable"));
    render(withWallet(<VotingPowerPreview snapshotLedger={SNAPSHOT_LEDGER} />));

    expect(await screen.findByText(/voting power unavailable/i)).toBeInTheDocument();
    expect(screen.getByText("RPC unavailable")).toBeInTheDocument();
    // Reporting a failed read as zero power would be a lie the voter acts on.
    expect(screen.queryByText(/no voting power on this proposal/i)).not.toBeInTheDocument();
  });
});
