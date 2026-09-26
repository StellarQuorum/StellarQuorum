import type { MetadataRoute } from "next";
import { getEnv } from "@/lib/env";

// Issue #141: the app is a public read surface, so crawlers are welcome
// everywhere. `/create` and the wallet flows are client-side only, so there is
// nothing private to hide — the file exists to point at the sitemap, not to
// keep anything out.
export default function robots(): MetadataRoute.Robots {
  const { siteUrl } = getEnv();
  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
