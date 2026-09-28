import { fireEvent, render, screen } from "@testing-library/react";
// Aliased so the component doesn't shadow the global Error constructor.
import ErrorBoundary from "./error";
import { describeVisual } from "@/test/visual";
import { expectNoA11yViolations } from "@/test/a11y";

// The boundary renders inside the root layout's <main>, so the test mounts it
// the same way — the a11y landmark check is only meaningful that way.
const renderError = (digest?: string) => {
  const reset = jest.fn();
  const error = new Error("super-secret internals") as Error & { digest?: string };
  error.digest = digest;
  const { container } = render(
    <main>
      <ErrorBoundary error={error} reset={reset} />
    </main>,
  );
  return { container, reset };
};

describe("Error boundary", () => {
  it("matches the visual baseline", () => {
    const { container } = renderError("abc123");
    expect(describeVisual(container.firstChild)).toMatchSnapshot();
  });

  it("explains what happened and offers a way out", () => {
    renderError();
    expect(screen.getByRole("heading", { name: "Something went wrong", level: 1 })).toBeInTheDocument();
    expect(
      screen.getByText("An unexpected error occurred while loading this page. You can try again, or head back to the home page."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute("href", "/");
  });

  it("re-renders the segment when Try again is clicked", () => {
    const { reset } = renderError();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("shows the digest as a support reference when there is one", () => {
    renderError("abc123");
    expect(screen.getByText("Reference abc123")).toBeInTheDocument();
  });

  it("omits the reference line when the error has no digest", () => {
    renderError();
    expect(screen.queryByText(/Reference/)).not.toBeInTheDocument();
  });

  it("never renders the error message", () => {
    renderError();
    expect(screen.queryByText("super-secret internals")).not.toBeInTheDocument();
  });

  it("is accessible", () => {
    const { container } = renderError("abc123");
    expectNoA11yViolations(container);
  });
});
