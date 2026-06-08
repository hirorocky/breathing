/** ip_request_windows.route_id */

export const ROUTE_ID = {
  presence: 1,
  words: 2,
} as const;

export type RouteId = (typeof ROUTE_ID)[keyof typeof ROUTE_ID];

export function routeIdFromPath(path: string): RouteId {
  if (path.endsWith("/presence")) return ROUTE_ID.presence;
  if (path.endsWith("/words")) return ROUTE_ID.words;
  return ROUTE_ID.presence;
}
