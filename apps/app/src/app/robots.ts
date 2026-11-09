import type { MetadataRoute } from "next";

/**
 * The app's own pages: program pages (/p/...) may be found, the dashboard, admin, API and the demo button
 * may not. A crawler following /demo would open a demo session on every visit.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/p/", disallow: ["/app", "/admin", "/api/", "/demo", "/embed", "/invite"] },
    ],
  };
}
