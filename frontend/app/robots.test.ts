import robots from "./robots";
import { getEnv } from "@/lib/env";

// Issue #141: robots.txt is the crawl guidance. The sitemap line is the part
// that matters here — without it a crawler has to guess at the URL space.
describe("robots", () => {
  it("allows crawlers and points at the sitemap", () => {
    const result = robots();
    const { siteUrl } = getEnv();

    expect(result.sitemap).toBe(`${siteUrl}/sitemap.xml`);
    expect(result.host).toBe(siteUrl);
    expect(result.rules).toEqual([{ userAgent: "*", allow: "/" }]);
  });

  it("does not block a page", () => {
    const { rules } = robots();

    expect(Array.isArray(rules)).toBe(true);
    expect(JSON.stringify(rules)).not.toContain("disallow");
  });
});
