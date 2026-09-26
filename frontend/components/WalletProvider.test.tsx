import { act, fireEvent, render, screen } from "@testing-library/react";
import WalletProvider, { useWallet } from "./WalletProvider";

const ADDRESS = "GABCDEFGHIJKLMNOPQRSTUVWXYZ3XZK";

function freighterReturning(publicKey: string) {
  return { connect: jest.fn().mockResolvedValue({ publicKey }) };
}

/** Surfaces the context the component under test exposes. */
function Probe() {
  const { address, pending, error, connect, disconnect } = useWallet();
  return (
    <div>
      <p data-testid="address">{address ?? "none"}</p>
      <p data-testid="pending">{String(pending)}</p>
      <p data-testid="error">{error ?? "none"}</p>
      <button onClick={connect}>connect</button>
      <button onClick={disconnect}>disconnect</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <WalletProvider>
      <Probe />
    </WalletProvider>,
  );
}

afterEach(() => {
  delete (window as { freighter?: unknown }).freighter;
});

describe("WalletProvider", () => {
  it("starts disconnected, so the preview prompts for a wallet", () => {
    window.freighter = freighterReturning(ADDRESS);
    renderProvider();
    expect(screen.getByTestId("address")).toHaveTextContent("none");
  });

  it("exposes the address the extension returns after connecting", async () => {
    const freighter = freighterReturning(ADDRESS);
    window.freighter = freighter;
    renderProvider();

    await act(async () => {
      fireEvent.click(screen.getByText("connect"));
    });

    expect(screen.getByTestId("address")).toHaveTextContent(ADDRESS);
    expect(freighter.connect).toHaveBeenCalled();
  });

  it("keeps the address across a client-side navigation", async () => {
    window.freighter = freighterReturning(ADDRESS);
    const { rerender } = render(
      <WalletProvider>
        <p>proposal list</p>
        <Probe />
      </WalletProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByText("connect"));
    });

    // The provider sits in the root layout, which the App Router keeps mounted
    // across navigation, so only the children below it are swapped.
    rerender(
      <WalletProvider>
        <p>proposal detail</p>
        <Probe />
      </WalletProvider>,
    );

    expect(screen.getByTestId("address")).toHaveTextContent(ADDRESS);
    // Still one prompt for one connection: navigating is not a reconnect.
    expect(window.freighter!.connect).toHaveBeenCalledTimes(1);
  });

  it("clears the address on disconnect", async () => {
    window.freighter = freighterReturning(ADDRESS);
    renderProvider();
    await act(async () => {
      fireEvent.click(screen.getByText("connect"));
    });
    expect(screen.getByTestId("address")).toHaveTextContent(ADDRESS);

    await act(async () => {
      fireEvent.click(screen.getByText("disconnect"));
    });

    expect(screen.getByTestId("address")).toHaveTextContent("none");
  });

  it("reports a missing extension instead of failing silently", async () => {
    renderProvider();

    await act(async () => {
      fireEvent.click(screen.getByText("connect"));
    });

    expect(screen.getByTestId("error")).toHaveTextContent(/no stellar wallet extension found/i);
    expect(screen.getByTestId("address")).toHaveTextContent("none");
  });

  it("reports a rejected connection and stays disconnected", async () => {
    window.freighter = { connect: jest.fn().mockRejectedValue(new Error("User rejected")) };
    renderProvider();

    await act(async () => {
      fireEvent.click(screen.getByText("connect"));
    });

    expect(screen.getByTestId("error")).toHaveTextContent("User rejected");
    expect(screen.getByTestId("address")).toHaveTextContent("none");
    expect(screen.getByTestId("pending")).toHaveTextContent("false");
  });

  it("clears a previous failure when the voter tries again", async () => {
    const connect = jest
      .fn()
      .mockRejectedValueOnce(new Error("User rejected"))
      .mockResolvedValueOnce({ publicKey: ADDRESS });
    window.freighter = { connect };
    renderProvider();

    await act(async () => {
      fireEvent.click(screen.getByText("connect"));
    });
    expect(screen.getByTestId("error")).toHaveTextContent("User rejected");

    await act(async () => {
      fireEvent.click(screen.getByText("connect"));
    });

    expect(screen.getByTestId("error")).toHaveTextContent("none");
    expect(screen.getByTestId("address")).toHaveTextContent(ADDRESS);
  });
});
