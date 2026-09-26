import sitemap from "./sitemap";
import { PROPOSALS } from "@/lib/proposals";
import { getEnv } from "@/lib/env";

// Issue #141: the sitemap has to cover the static routes and the proposal
// detail pages, all as absolute URLs. A relative or duplicated entry is a
// silently broken sitemap, so the shape is asserted rather than eyeballed.
const { siteUrl } = getEnv();

describe("sitemap", () => {
  it("lists every static route as an absolute URL", async () => {
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(urls).toEqual(
      expect.arrayContaining([`${siteUrl}/`, `${siteUrl}/proposals`, `${siteUrl}/create`]),
    );
    for (const url of urls) {
      expect(url.startsWith(`${siteUrl}/`)).toBe(true);
    }
  });

  it("includes a detail page for every proposal", async () => {
    const entries = await sitemap();

    for (const proposal of PROPOSALS) {
      const entry = entries.find((candidate) => candidate.url === `${siteUrl}/proposals/${proposal.id}`);
      expect(entry).toBeDefined();
      expect(entry!.lastModified).toEqual(new Date(proposal.endTime));
    }
  });

  it("has no duplicate URLs", async () => {
    const urls = (await sitemap()).map((entry) => entry.url);

    expect(new Set(urls).size).toBe(urls.length);
  });
});
