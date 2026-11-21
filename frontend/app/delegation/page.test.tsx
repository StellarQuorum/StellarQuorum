import { render, screen, waitFor } from "@testing-library/react";
import DelegationPage from "./page";
import { WalletContext, type WalletContextValue } from "../../components/WalletProvider";
import { createQuorumClient } from "../../lib/config";

jest.mock("../../lib/config", () => ({ createQuorumClient: jest.fn() }));

const mockedClient = jest.mocked(createQuorumClient);
const wallet = (address: string | null): WalletContextValue => ({
  address, connectedAddresses: address ? [address] : [], pending: false, error: null,
  activeWalletId: null, availableWallets: [], connect: jest.fn(), disconnect: jest.fn(), switchAccount: jest.fn(),
});
const renderWithWallet = (address: string | null) => render(
  <WalletContext.Provider value={wallet(address)}><DelegationPage /></WalletContext.Provider>,
);

describe("DelegationPage", () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it("prompts an unconnected visitor to connect", () => {
    renderWithWallet(null);
    expect(screen.getByText("Connect a wallet to view delegation changes for that account.")).toBeInTheDocument();
  });

  it("loads delegated events for the connected account and displays an empty state", async () => {
    mockedClient.mockResolvedValue({ getDelegationEvents: jest.fn().mockResolvedValue([]) } as never);
    renderWithWallet("GUSER");
    await waitFor(() => expect(screen.getByText("No delegation changes were found for this account in the available event history.")).toBeInTheDocument());
  });

  it("renders on-chain delegation and revocation events", async () => {
    mockedClient.mockResolvedValue({ getDelegationEvents: jest.fn().mockResolvedValue([
      { type: "delegated", ledger: 42, delegator: "GUSER", delegatee: "GDELEGATE" },
      { type: "delegated", ledger: 39, delegator: "GUSER", delegatee: "GUSER" },
    ]) } as never);
    renderWithWallet("GUSER");
    await waitFor(() => expect(screen.getByText("GDELEGATE")).toBeInTheDocument());
    expect(screen.getByText("#42")).toBeInTheDocument();
    expect(screen.getByText("Revoked")).toBeInTheDocument();
  });
});
