import { fireEvent, render, screen } from "@testing-library/react";
import CreatePage from "./page";

// The draft is kept in localStorage, so one test's draft would otherwise be
// restored into the next test's form.
beforeEach(() => window.localStorage.clear());

describe("CreatePage templates", () => {
  // Issue #281: picking a template pre-fills the description and category.
  it("pre-fills the description and category from the chosen template", () => {
    render(<CreatePage />);
    fireEvent.click(screen.getByRole("button", { name: "Parameter Change" }));
    const description = screen.getByLabelText<HTMLTextAreaElement>("Description *");
    expect(description.value).toContain("## Current value");
    expect(description.value).toContain("## Proposed value");
    expect(description.value).toContain("## Rationale");
    expect(screen.getByLabelText("Category *")).toHaveValue("Protocol");
  });

  it("pre-fills a treasury template with the treasury category", () => {
    render(<CreatePage />);
    fireEvent.click(screen.getByRole("button", { name: "Treasury Spend" }));
    expect(screen.getByLabelText<HTMLTextAreaElement>("Description *").value).toContain("## Recipient");
    expect(screen.getByLabelText("Category *")).toHaveValue("Treasury");
  });

  it("keeps the form blank when Blank is picked", () => {
    render(<CreatePage />);
    fireEvent.click(screen.getByRole("button", { name: "Blank" }));
    expect(screen.getByLabelText("Description *")).toHaveValue("");
    expect(screen.getByLabelText("Category *")).toHaveValue("Governance");
  });

  it("hides the picker once a template has filled the description", () => {
    render(<CreatePage />);
    fireEvent.click(screen.getByRole("button", { name: "Signaling" }));
    expect(screen.queryByRole("button", { name: "Parameter Change" })).not.toBeInTheDocument();
  });
});

describe("CreatePage review step", () => {
  it("reviews details and returns to editing without losing values", () => {
    render(<CreatePage />);
    fireEvent.change(screen.getByLabelText("Title *"), { target: { value: "Fund the SDK" } });
    fireEvent.change(screen.getByLabelText("Description *"), { target: { value: "Ship a documented SDK." } });
    fireEvent.click(screen.getByRole("button", { name: "Review proposal" }));
    expect(screen.getByRole("heading", { name: "Fund the SDK", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("7 days")).toBeInTheDocument();
    expect(screen.getByText("5% of circulating QUORUM supply")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign and submit" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit proposal" }));
    expect(screen.getByLabelText("Title *")).toHaveValue("Fund the SDK");
    expect(screen.getByLabelText("Description *")).toHaveValue("Ship a documented SDK.");
  });
});
