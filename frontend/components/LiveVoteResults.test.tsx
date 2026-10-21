import { act, render, screen } from "@testing-library/react";
import LiveVoteResults from "./LiveVoteResults";
import { PROPOSALS } from "@/lib/proposals";
import { LIVE_POLL_INTERVAL_MS } from "@/lib/useLiveProposal";
import type { Proposal } from "@/lib/types";

// Issue #41: vote counts refresh every 10s while the page is visible, and
// polling stops while the tab is hidden.
const initial: Proposal = PROPOSALS[0];
const updated: Proposal = {
  ...initial,
  forVotes: initial.forVotes + 500_000,
  votes: [...initial.votes, { voter: "GNEW...VOTE", choice: "for", weight: 500_000, timestamp: "2026-05-15T10:00:00Z" }],
};

let visibility: DocumentVisibilityState = "visible";
const fetchMock = jest.fn();

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeAll(() => {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});

beforeEach(() => {
  jest.useFakeTimers();
  visibility = "visible";
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => updated });
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  jest.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

it("shows the server-rendered counts before the first poll", () => {
  render(<LiveVoteResults initial={initial} />);

  expect(screen.getByText("842K")).toBeInTheDocument();
  expect(screen.getByText("Updated just now")).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("refreshes the counts and voter list every 10 seconds", async () => {
  render(<LiveVoteResults initial={initial} />);

  await advance(LIVE_POLL_INTERVAL_MS);

  expect(fetchMock).toHaveBeenCalledWith(`/api/proposals/${initial.id}`, { cache: "no-store" });
  expect(screen.getByText("1342K")).toBeInTheDocument();
  expect(screen.getByText("GNEW...VOTE")).toBeInTheDocument();
});

it("counts the seconds since the last update", async () => {
  render(<LiveVoteResults initial={initial} />);

  await advance(3_000);

  expect(screen.getByText("Updated 3s ago")).toBeInTheDocument();
});

it("stops polling while the page is hidden and reads again when it returns", async () => {
  render(<LiveVoteResults initial={initial} />);

  act(() => setVisibility("hidden"));
  await advance(LIVE_POLL_INTERVAL_MS * 3);
  expect(fetchMock).not.toHaveBeenCalled();

  await act(async () => setVisibility("visible"));
  expect(fetchMock).toHaveBeenCalledTimes(1);

  await advance(LIVE_POLL_INTERVAL_MS);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("keeps the last counts when a poll fails", async () => {
  fetchMock.mockRejectedValue(new Error("offline"));
  render(<LiveVoteResults initial={initial} />);

  await advance(LIVE_POLL_INTERVAL_MS);

  expect(screen.getByText("842K")).toBeInTheDocument();
});

it("renders children between the results and the voter list", () => {
  render(<LiveVoteResults initial={initial}><p>Vote buttons</p></LiveVoteResults>);

  expect(screen.getByText("Vote buttons")).toBeInTheDocument();
});
