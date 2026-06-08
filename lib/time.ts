import { Temporal } from "@/lib/temporal-polyfill";

export function nowMs(): number {
  return Temporal.Now.instant().epochMilliseconds;
}
