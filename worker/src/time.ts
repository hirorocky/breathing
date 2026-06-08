import { Temporal } from "@js-temporal/polyfill";

export function nowUnixSeconds(): number {
  return Math.floor(Temporal.Now.instant().epochMilliseconds / 1000);
}

export function utcDayKey(
  instant: Temporal.Instant = Temporal.Now.instant(),
): string {
  const plainDate = instant.toZonedDateTimeISO("UTC").toPlainDate();
  return `day:${plainDate.toString()}`;
}

export function utcMonthKey(
  instant: Temporal.Instant = Temporal.Now.instant(),
): string {
  const yearMonth = instant
    .toZonedDateTimeISO("UTC")
    .toPlainDate()
    .toPlainYearMonth();
  return `month:${yearMonth.toString()}`;
}
