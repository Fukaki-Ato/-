const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const pad = value => String(value).padStart(2, '0');

/** Mainland China has used UTC+08:00 without daylight saving since 1991. */
export function getMissionPeriods(timestamp) {
  if (!Number.isFinite(timestamp)) throw new TypeError('timestamp must be finite');
  const beijingDate = new Date(timestamp + BEIJING_OFFSET_MS);
  const year = beijingDate.getUTCFullYear();
  const month = beijingDate.getUTCMonth();
  const day = beijingDate.getUTCDate();
  const dayStartLocal = Date.UTC(year, month, day);
  const dailyId = `${year}-${pad(month + 1)}-${pad(day)}`;
  const weekday = new Date(dayStartLocal).getUTCDay();
  const daysSinceMonday = (weekday + 6) % 7;
  const weekStartLocal = dayStartLocal - daysSinceMonday * DAY_MS;
  const weekDate = new Date(weekStartLocal);
  const weeklyId = `${weekDate.getUTCFullYear()}-${pad(weekDate.getUTCMonth() + 1)}-${pad(weekDate.getUTCDate())}`;
  return {
    daily: { periodId: dailyId, resetsAt: dayStartLocal + DAY_MS - BEIJING_OFFSET_MS },
    weekly: { periodId: weeklyId, resetsAt: weekStartLocal + 7 * DAY_MS - BEIJING_OFFSET_MS },
  };
}
