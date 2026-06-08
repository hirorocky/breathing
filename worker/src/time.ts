import { Temporal } from "@js-temporal/polyfill";

export function nowUnixSeconds(): number {
  return Math.floor(Temporal.Now.instant().epochMilliseconds / 1000);
}

function utcMidnightUnix(plainDate: Temporal.PlainDate): number {
  const zdt = plainDate.toZonedDateTime({
    timeZone: "UTC",
    plainTime: Temporal.PlainTime.from("00:00:00"),
  });
  return Math.floor(zdt.epochMilliseconds / 1000);
}

/** 当日 UTC 00:00 の unix 秒（api_usage_buckets 用） */
export function utcDayStartUnix(
  instant: Temporal.Instant = Temporal.Now.instant(),
): number {
  return utcMidnightUnix(instant.toZonedDateTimeISO("UTC").toPlainDate());
}

/** 当月 1 日 UTC 00:00 の unix 秒（api_usage_buckets 用） */
export function utcMonthStartUnix(
  instant: Temporal.Instant = Temporal.Now.instant(),
): number {
  const yearMonth = instant
    .toZonedDateTimeISO("UTC")
    .toPlainDate()
    .toPlainYearMonth();
  return utcMidnightUnix(yearMonth.toPlainDate({ day: 1 }));
}
