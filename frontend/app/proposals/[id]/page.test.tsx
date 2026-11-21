import { render, screen } from "@testing-library/react";
import ProposalDetailPage from "./page";
import { WalletContext, type WalletContextValue } from "@/components/WalletProvider";

// Issue #146 and #147 on the detail page: the voter list and the quorum
// indicator are the two things a reader comes here for, and both are assembled
// from the same tallies — so the page is rendered and the result asserted
// against the fixture's proposals rather than against the components alone.

const DISCONNECTED: WalletContextValue = {
  address: null,
  pending: false,
  error: null,
  connect: jest.fn(),
  disconnect: jest.fn(),
};

async function renderDetail(id: string) {
  const page = await ProposalDetailPage({ params: Promise.resolve({ id }) });
  return render(<WalletContext.Provider value={DISCONNECTED}>{page}</WalletContext.Provider>);
}

describe("proposal detail page", () => {
  it("lists recent voters with their choice and weight", async () => {
    await renderDetail("QIP-001");

    expect(screen.getByRole("heading", { name: "Recent Votes" })).toBeInTheDocument();
    expect(screen.getByText("GDEF...8YPQ")).toBeInTheDocument();
    expect(screen.getByText("120,000")).toBeInTheDocument();
    // Against and Abstain are on the fixture proposal too, so all three
    // choices are covered.
    expect(screen.getByText("against")).toBeInTheDocument();
    expect(screen.getByText("abstain")).toBeInTheDocument();
  });

  it("shows quorum progress counting every choice, as finalize() does", async () => {
    // QIP-001: 842,000 + 124,000 + 34,000 = 1,000,000 of a 500,000 quorum.
    await renderDetail("QIP-001");

    expect(screen.getByText("1,000,000 / 500,000 required")).toBeInTheDocument();
    expect(screen.getAllByText("Quorum reached").length).toBeGreaterThan(0);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "500000");
  });

  it("shows a proposal that missed quorum as short, not as a passed one", async () => {
    // QIP-008: 390,000 + 620,000 + 90,000 = 1,100,000 — well past quorum, and
    // it failed on the vote rather than the turnout.
    const reached = await renderDetail("QIP-008");
    expect(screen.getAllByText("Quorum reached").length).toBeGreaterThan(0);
    reached.unmount();

    // A proposal nobody has voted on yet.
    await renderDetail("QIP-007");
    expect(screen.getByText("0 / 500,000 required")).toBeInTheDocument();
    expect(screen.getByText("500,000 short of quorum")).toBeInTheDocument();
  });

  it("says so plainly when the proposal does not exist", async () => {
    await renderDetail("QIP-999");

    expect(screen.getByRole("heading", { name: "Proposal not found" })).toBeInTheDocument();
  });

  it("shows the recorded guardian and reason when a proposal was vetoed", async () => {
    await renderDetail("QIP-009");
    expect(screen.getByRole("note", { name: "Veto details" })).toBeInTheDocument();
    expect(screen.getByText("The recipient address has not completed treasury due diligence.")).toBeInTheDocument();
    expect(screen.getByText("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF")).toBeInTheDocument();
  });

  it("shows co-sponsors with copy controls and decodes proposal action arguments", async () => {
    await renderDetail("QIP-001");
    expect(screen.getByLabelText("Co-sponsors")).toBeInTheDocument();
    expect(screen.getByText("GCO...…SP01")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy GCO...SP01" })).toBeInTheDocument();
    expect(screen.getByText(/\[\s*500\s*\]/)).toBeInTheDocument();
  });
});
