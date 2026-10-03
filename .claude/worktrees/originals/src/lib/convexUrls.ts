/**
 * Convex HTTP-action base URL.
 *
 * Convex serves functions on .convex.cloud and HTTP actions on .convex.site
 * (locally, :3210 and :3211). Extracted from useAuth so other modules can call
 * HTTP endpoints without importing the auth provider and creating a cycle.
 */
export function getConvexHttpUrl(): string {
  const convexUrl = import.meta.env.VITE_CONVEX_URL as string;

  // Local development
  if (convexUrl.includes("127.0.0.1") || convexUrl.includes("localhost")) {
    return convexUrl.replace(":3210", ":3211");
  }

  // Convex cloud deployment
  return convexUrl.replace(".convex.cloud", ".convex.site");
}
