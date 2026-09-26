import { render, screen } from "@testing-library/react";
import Navbar from "./Navbar";
import { WalletContext, type WalletContextValue } from "./WalletProvider";
import { describeVisual } from "@/test/visual";

// Issue #168: the sticky header defines the chrome every page shares, so its
// link treatment and the connect button are baselined like the rest. The button
// is also the only place the connected address enters the app, so the connected
// state is baselined too: it has to be recognisable at a glance, and short
// enough not to break the header.
const DISCONNECTED: WalletContextValue = {
  address: null,
  pending: false,
  error: null,
  connect: jest.fn(),
  disconnect: jest.fn(),
};

function renderNavbar(value: Partial<WalletContextValue> = {}) {
  return render(
    <WalletContext.Provider value={{ ...DISCONNECTED, ...value }}>
      <Navbar />
    </WalletContext.Provider>,
  );
}

describe("Navbar", () => {
  it("matches the visual baseline", () => {
    const { container } = renderNavbar();
    expect(describeVisual(container.firstChild)).toMatchSnapshot();
  });

  it("matches the visual baseline with a wallet connected", () => {
    const { container } = renderNavbar({ address: "GABCDEFGHIJKLMNOPQRSTUVWXYZ3XZK" });
    expect(describeVisual(container.firstChild)).toMatchSnapshot();
  });

  it("offers a shortened address and a way out once connected", () => {
    renderNavbar({ address: "GABCDEFGHIJKLMNOPQRSTUVWXYZ3XZK" });

    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("…YZ3XZK");
    // The full address stays reachable for anyone who needs to check which
    // account the preview is about to be read for.
    expect(button).toHaveAccessibleName("Disconnect wallet GABCDEFGHIJKLMNOPQRSTUVWXYZ3XZK");
  });

  it("does not offer a disconnect before a wallet is connected", () => {
    renderNavbar();
    expect(screen.getByRole("button", { name: /connect wallet/i })).toBeInTheDocument();
  });

  it("reports a refused or unavailable wallet instead of failing silently", () => {
    const { container } = renderNavbar({ error: "No Stellar wallet extension found." });
    expect(screen.getByRole("alert")).toHaveTextContent(/no stellar wallet extension found/i);
    expect(describeVisual(container.firstChild)).toMatchSnapshot();
  });
});

// Keeps the wrapper honest: the header is only reachable through the provider.
describe("Navbar without a provider", () => {
  it("fails loudly rather than rendering a dead connect button", () => {
    const silence = jest.spyOn(console, "error").mockImplementation(() => {});
    function Unwrapped() {
      return <Navbar />;
    }
    expect(() => render(<Unwrapped />)).toThrow(/WalletProvider/);
    silence.mockRestore();
  });
});
