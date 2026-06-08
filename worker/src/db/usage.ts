/** api_usage_buckets.granularity */

export const USAGE_GRANULARITY = {
  day: 1,
  month: 2,
} as const;

export type UsageGranularity =
  (typeof USAGE_GRANULARITY)[keyof typeof USAGE_GRANULARITY];
