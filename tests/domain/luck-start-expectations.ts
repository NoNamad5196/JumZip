/** Independent manual expectations, frozen by Main on 2026-09-20 before M9
 * date-selection implementation. No production date helper or library result
 * generated these values. These verify the user-adopted product convention,
 * not a claim that one traditional school is astronomically authoritative.
 *
 * Start years/months select the target civil month together; clamp the original
 * day there once, then add whole calendar days. Every decade is anchored to the
 * first start date, so an intervening non-leap year does not erase February 29
 * from a later leap-year boundary. All interval ends are excluded.
 */
export const LUCK_START_EXPECTATIONS = [
  { id:'ordinary', birthDate:'1990-05-10', startYears:5, startMonths:3, startDays:12, expectedStart:'1995-08-22' },
  { id:'leap-day-clamp', birthDate:'2000-02-29', startYears:1, startMonths:0, startDays:0, expectedStart:'2001-02-28' },
  { id:'combined-year-month', birthDate:'2000-02-29', startYears:1, startMonths:1, startDays:0, expectedStart:'2001-03-29' },
  { id:'short-month', birthDate:'2001-01-31', startYears:0, startMonths:1, startDays:0, expectedStart:'2001-02-28' },
  { id:'days-after-clamp', birthDate:'2001-01-31', startYears:0, startMonths:1, startDays:1, expectedStart:'2001-03-01' },
  { id:'leap-month-then-days', birthDate:'1999-12-31', startYears:0, startMonths:2, startDays:3, expectedStart:'2000-03-03' },
  { id:'multi-year-month-rollover', birthDate:'2000-11-30', startYears:2, startMonths:3, startDays:2, expectedStart:'2003-03-02' },
  { id:'zero-offset', birthDate:'2000-02-29', startYears:0, startMonths:0, startDays:0, expectedStart:'2000-02-29' },
] as const;

export const LUCK_PERIOD_EXPECTATIONS = [
  { id:'before-first', firstStart:'1995-08-22', localDate:'1995-08-21', expectedIndex:null, expectedStart:null, expectedEnd:null },
  { id:'first-inclusive', firstStart:'1995-08-22', localDate:'1995-08-22', expectedIndex:0, expectedStart:'1995-08-22', expectedEnd:'2005-08-22' },
  { id:'last-day-first', firstStart:'1995-08-22', localDate:'2005-08-21', expectedIndex:0, expectedStart:'1995-08-22', expectedEnd:'2005-08-22' },
  { id:'next-inclusive', firstStart:'1995-08-22', localDate:'2005-08-22', expectedIndex:1, expectedStart:'2005-08-22', expectedEnd:'2015-08-22' },
  { id:'current-example', firstStart:'1995-08-22', localDate:'2026-09-20', expectedIndex:3, expectedStart:'2025-08-22', expectedEnd:'2035-08-22' },
  { id:'leap-anchor-before', firstStart:'2000-02-29', localDate:'2020-02-28', expectedIndex:1, expectedStart:'2010-02-28', expectedEnd:'2020-02-29' },
  { id:'leap-anchor-restored', firstStart:'2000-02-29', localDate:'2020-02-29', expectedIndex:2, expectedStart:'2020-02-29', expectedEnd:'2030-02-28' },
] as const;

export const LUCK_TIMEZONE_EXPECTATIONS = [
  { id:'seoul-before-midnight', timezone:'Asia/Seoul', asOf:'2005-08-21T14:59:00Z', expectedLocalDate:'2005-08-21', expectedIndex:0 },
  { id:'seoul-midnight', timezone:'Asia/Seoul', asOf:'2005-08-21T15:00:00Z', expectedLocalDate:'2005-08-22', expectedIndex:1 },
  // New York is UTC-04:00 on this August date; this is a civil-date boundary,
  // not a newly invented policy for resolving ambiguous birth clock times.
  { id:'new-york-before-midnight', timezone:'America/New_York', asOf:'2005-08-22T03:59:00Z', expectedLocalDate:'2005-08-21', expectedIndex:0 },
  { id:'new-york-midnight', timezone:'America/New_York', asOf:'2005-08-22T04:00:00Z', expectedLocalDate:'2005-08-22', expectedIndex:1 },
] as const;
