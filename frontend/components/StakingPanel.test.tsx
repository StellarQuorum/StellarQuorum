import { render, screen } from "@testing-library/react";
import StakingPanel from "./StakingPanel";
import { WalletContext, type WalletContextValue } from "./WalletProvider";

const DISCONNECTED: WalletContextValue = {
  address: null,
  connectedAddresses: [],
  pending: false,
  error: null,
  activeWalletId: null,
  availableWallets: [],
  connect: jest.fn(),
  disconnect: jest.fn(),
  switchAccount: jest.fn(),
};

describe("staking panel", () => {
  it("explains that fixture mode cannot submit staking transactions", () => {
    render(<WalletContext.Provider value={DISCONNECTED}><StakingPanel /></WalletContext.Provider>);
    expect(screen.getByText(/Staking needs a live governance deployment/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install Freighter or Albedo" })).toBeDisabled();
  });
});
