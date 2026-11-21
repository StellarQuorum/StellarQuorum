import { formatProposalSubmissionError, submitProposal } from "./createProposal";

describe("submitProposal", () => {
  it("signs, waits for confirmation, and returns the created proposal id", async () => {
    const client = {
      getProposalCount: jest.fn().mockResolvedValueOnce(2n).mockResolvedValueOnce(3n),
      buildCreateProposal: jest.fn().mockResolvedValue("unsigned"),
      submitAndWait: jest.fn().mockResolvedValue({ txHash: "abc" }),
      getProposal: jest.fn().mockResolvedValue({ proposer: "GPROPOSER", title: "Title", description: "Body" }),
    };
    const wallet = { signTransaction: jest.fn().mockResolvedValue("signed") };
    await expect(submitProposal(client as never, wallet as never, "GPROPOSER", { title: "Title", description: "Body" }))
      .resolves.toEqual({ id: 3n, transactionHash: "abc" });
    expect(client.submitAndWait).toHaveBeenCalledWith("signed");
  });
});

describe("formatProposalSubmissionError", () => {
  it.each([
    [9, "The proposer is below the proposal threshold"],
    [33, "The proposer is still on cooldown"],
    [30, "The proposer deposit is insufficient"],
  ] as const)("formats contract error %i", (code, message) => {
    expect(formatProposalSubmissionError({ code })).toBe(message);
    expect(formatProposalSubmissionError({ contractErrorCode: code })).toBe(message);
  });
});
