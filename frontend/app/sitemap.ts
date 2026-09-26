import type { MetadataRoute } from "next";
import { getProposals } from "@/lib/proposals";
import { getEnv } from "@/lib/env";

// Issue #141: the sitemap is the app's index. It has to carry the static
// routes *and* every proposal detail page, because those are the pages search
// engines are actually looking for and they are only known from the data layer.
type ChangeFrequency = NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;

const STATIC_ROUTES: readonly { path: string; priority: number; changeFrequency: ChangeFrequency }[] = [
  { path: "/", priority: 1, changeFrequency: "daily" },
  { path: "/proposals", priority: 0.9, changeFrequency: "daily" },
  { path: "/create", priority: 0.5, changeFrequency: "monthly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { siteUrl } = getEnv();
  const proposals = await getProposals();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((route) => ({
    url: `${siteUrl}${route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));

  // A proposal's last modification is the end of its voting window: after that
  // the tally can still move, but the page is not rewritten.
  const proposalEntries: MetadataRoute.Sitemap = proposals.map((proposal) => ({
    url: `${siteUrl}/proposals/${proposal.id}`,
    lastModified: new Date(proposal.endTime),
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [...staticEntries, ...proposalEntries];
}
