import { fireEvent, render, screen } from "@testing-library/react";
import DigestSignup from "./DigestSignup";

describe("DigestSignup", () => {
  beforeEach(() => window.localStorage.clear());

  it("describes the local-only interest list without promising email delivery", () => {
    render(<DigestSignup />);
    expect(screen.getByText(/subscriptions are coming soon/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "reader@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save interest" }));
    expect(screen.getByRole("status")).toHaveTextContent(/not subscribed to email updates/i);
    expect(screen.queryByText(/you are signed up/i)).not.toBeInTheDocument();
    expect(window.localStorage.getItem("quorum-email-digest")).toBe("reader@example.com");
  });
});
