import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Interactive elements signal themselves with hover styles, which keyboard
// focus never triggers, and the browser default outline is inconsistent across
// browsers and elements. The app therefore defines one global :focus-visible
// indicator in globals.css and mirrors hover affordances with focus-visible
// utilities on every interactive component.
//
// jsdom does not apply stylesheet rules, so behaviour cannot be asserted from
// rendered markup; these tests assert the source holds up its end instead —
// the indicator exists, no utility suppresses it, and no hover affordance is
// left without a keyboard equivalent.

const appRoot = resolve(__dirname, "..", "app");
const componentsRoot = resolve(__dirname, "..", "components");

function read(relativePath: string): string {
  return readFileSync(resolve(appRoot, relativePath), "utf8");
}

function appSources(): { path: string; source: string }[] {
  const sources: { path: string; source: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.name.endsWith(".tsx")) {
        sources.push({ path: entryPath, source: readFileSync(entryPath, "utf8") });
      }
    }
  };
  walk(appRoot);
  walk(componentsRoot);
  return sources;
}

describe("focus-visible styling", () => {
  it("defines a global focus-visible indicator in globals.css", () => {
    const css = read("globals.css").replace(/\/\*[\s\S]*?\*\//g, "");

    const indicator = css.match(/:focus-visible\s*\{([^}]*)\}/);
    expect(indicator).not.toBeNull();
    // The ring has to be visible, not just a recolor: an outline declaration.
    expect(indicator![1]).toMatch(/outline\s*:/);
  });

  it("mirrors every hover affordance with a focus-visible equivalent", () => {
    const withHover = appSources().filter((entry) => entry.source.includes("hover:"));
    expect(withHover.length).toBeGreaterThan(0);

    for (const entry of withHover) {
      expect(entry.source).toContain("focus-visible:");
    }
  });

  it("leaves no outline-none suppression in the source", () => {
    for (const entry of appSources()) {
      expect(entry.source).not.toContain("outline-none");
    }
  });
});
