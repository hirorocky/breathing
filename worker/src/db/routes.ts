/** ip_throttle.route */

export type ThrottleRoute = "presence" | "words";

export function routeFromPath(path: string): ThrottleRoute {
  if (path.endsWith("/words")) return "words";
  return "presence";
}
