import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import ProposalLifecycleActions from "./ProposalLifecycleActions";

const mockClient = {
  getProposalPhase: jest.fn(),
  buildFinalize: jest.fn(),
  buildExecute: jest.fn(),
  submitAndWait: jest.fn(),
};
const mockWallet = { id: "freighter", signTransaction: jest.fn() };
const mockUseWallet = jest.fn();

jest.mock("../lib/config", () => ({
  USE_FIXTURE: false,
  createQuorumClient: jest.fn(async () => mockClient),
}));
jest.mock("./WalletProvider", () => ({ useWallet: () => mockUseWallet() }));

describe("ProposalLifecycleActions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockClient.getProposalPhase.mockResolvedValue("Active");
    mockClient.buildFinalize.mockResolvedValue("unsigned");
    mockClient.buildExecute.mockResolvedValue("unsigned");
    mockClient.submitAndWait.mockResolvedValue({});
    mockWallet.signTransaction.mockResolvedValue("signed");
    mockUseWallet.mockReturnValue({ address: "GABC", activeWalletId: "freighter", availableWallets: [mockWallet], connect: jest.fn(), pending: false });
  });

  it("renders no lifecycle action outside Ended and ReadyToExecute", async () => {
    render(<ProposalLifecycleActions proposalId="QIP-009" />);
    await waitFor(() => expect(mockClient.getProposalPhase).toHaveBeenCalledWith(9n));
    expect(screen.queryByRole("button", { name: "Finalize" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Execute" })).not.toBeInTheDocument();
  });

  it("finalizes from the connected wallet and waits for confirmation", async () => {
    mockClient.getProposalPhase.mockResolvedValue("Ended");
    render(<ProposalLifecycleActions proposalId="QIP-009" />);
    const button = await screen.findByRole("button", { name: "Finalize" });
    fireEvent.click(button);
    await waitFor(() => expect(mockClient.submitAndWait).toHaveBeenCalledWith("signed"));
    expect(mockClient.buildFinalize).toHaveBeenCalledWith("GABC", 9n);
    expect(mockWallet.signTransaction).toHaveBeenCalledWith("unsigned");
  });

  it("offers Execute only after the timelock", async () => {
    mockClient.getProposalPhase.mockResolvedValue("ReadyToExecute");
    render(<ProposalLifecycleActions proposalId="QIP-009" />);
    fireEvent.click(await screen.findByRole("button", { name: "Execute" }));
    await waitFor(() => expect(mockClient.buildExecute).toHaveBeenCalledWith("GABC", 9n));
  });
});
