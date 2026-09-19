/** Transcribed from rendered KASI tables BEFORE running the implementation against them.
 * No engine imports: these expected facts are not calculated by manseryeok or JumZip.
 * Hanja/Korean spellings are parallel transcriptions, not calculated sexagenary values. */
export const KASI_SOURCE = Object.freeze({
  title: '2024 역서 / Korean Astronomical Almanac',
  publisher: '한국천문연구원',
  url: 'https://astro.kasi.re.kr/file/astro_almanac_pdf/20231023135218580.pdf',
  sha256: '967fcf5dba1ab002ab0627ae39b6863af60ec96e2d742d1764056fa300fff7dc',
  reviewedOn: '2026-09-20', timezone: 'Asia/Seoul', utcOffsetMinutes: 540,
  precision: { solarTerms: 'MINUTE', solarTransit: 'SECOND', calendarDates: 'DAY' },
});

export const KASI_CALENDAR_CASES = Object.freeze([
  { lunar: '2024-01-01', leap: false, solar: '2024-02-10', day: '갑진', hanja: '甲辰', page: 8 },
  { lunar: '2024-02-01', leap: false, solar: '2024-03-10', day: '계유', hanja: '癸酉', page: 8 },
  { lunar: '2024-03-01', leap: false, solar: '2024-04-09', day: '계묘', hanja: '癸卯', page: 8 },
  { lunar: '2024-04-01', leap: false, solar: '2024-05-08', day: '임신', hanja: '壬申', page: 8 },
  { lunar: '2024-05-01', leap: false, solar: '2024-06-06', day: '신축', hanja: '辛丑', page: 8 },
  { lunar: '2024-06-01', leap: false, solar: '2024-07-06', day: '신미', hanja: '辛未', page: 8 },
  { lunar: '2024-07-01', leap: false, solar: '2024-08-04', day: '경자', hanja: '庚子', page: 8 },
  { lunar: '2024-08-01', leap: false, solar: '2024-09-03', day: '경오', hanja: '庚午', page: 8 },
  { lunar: '2024-09-01', leap: false, solar: '2024-10-03', day: '경자', hanja: '庚子', page: 8 },
  { lunar: '2024-10-01', leap: false, solar: '2024-11-01', day: '기사', hanja: '己巳', page: 8 },
  { lunar: '2024-11-01', leap: false, solar: '2024-12-01', day: '기해', hanja: '己亥', page: 8 },
  { lunar: '2024-12-01', leap: false, solar: '2024-12-31', day: '기사', hanja: '己巳', page: 8 },
  { lunar: '1992-09-01', leap: false, solar: '1992-09-26', day: '을사', hanja: '乙巳', page: 225 },
  { lunar: '2020-04-01', leap: false, solar: '2020-04-23', day: '병신', hanja: '丙申', page: 227 },
  { lunar: '2020-04-01', leap: true, solar: '2020-05-23', day: '병인', hanja: '丙寅', page: 227 },
].map(value => Object.freeze(value)));

/** One published minute is the preselected comparison tolerance. The PDF publishes no
 * seconds for solar terms; passing this test cannot certify an exact second or an edge
 * inside that minute. This tolerance is fixed before observing library output. */
export const KASI_SOLAR_TERMS = Object.freeze([
  { name: '입춘', index: 2, kst: '2024-02-04T17:27:00+09:00' },
  { name: '경칩', index: 4, kst: '2024-03-05T11:23:00+09:00' },
  { name: '청명', index: 6, kst: '2024-04-04T16:02:00+09:00' },
  { name: '하지', index: 11, kst: '2024-06-21T05:51:00+09:00' },
  { name: '추분', index: 17, kst: '2024-09-22T21:44:00+09:00' },
  { name: '동지', index: 23, kst: '2024-12-21T18:21:00+09:00' },
].map(value => Object.freeze({ ...value, page: 8, toleranceMs: 60_000 })));

export const KASI_SEOUL = Object.freeze({
  name: 'Seoul (KASI almanac reference)', timezone: 'Asia/Seoul',
  latitude: 37 + 34 / 60, longitude: 126 + 58 / 60 + 42 / 3600, page: 2,
});
export const KASI_FEBRUARY_DAYS = Object.freeze({
  '2024-02-09': '계묘', '2024-02-10': '갑진', '2024-02-11': '을사', page: 14,
});
export const KASI_SOLAR_TRANSIT = Object.freeze({
  date: '2024-02-10', kst: '12:46:16', page: 14,
  // Civil 07:05 is about 06:18:44 apparent: far from the 07:00 hour boundary.
  derivedCivilTime: '07:05', derivedApparentHourBranch: '묘', civilHourBranch: '진',
});

/** IANA is primary for tzdb conventions, not a separate astronomical authority. Intl
 * itself uses tzdb; these test the adapter's interpretation of fixed published rules. */
export const IANA_CASES = Object.freeze([
  { timezone: 'Asia/Seoul', latitude: 37.5665, longitude: 126.978,
    gapDate: '1988-05-08', gapTime: '02:30', foldDate: '1988-10-09', foldTime: '02:30',
    source: 'https://data.iana.org/time-zones/tzdb/asia', sourceVersion: '2026d', rule: 'ROK 1987–1988 May Sun>=8 02:00 +01:00; Oct Sun>=8 03:00 +00:00' },
  { timezone: 'America/New_York', latitude: 40.7128, longitude: -74.006,
    gapDate: '2024-03-10', gapTime: '02:30', foldDate: '2024-11-03', foldTime: '01:30',
    source: 'https://data.iana.org/time-zones/tzdb/northamerica', sourceVersion: '2026d', rule: 'US 2007–max Mar Sun>=8 02:00 +01:00; Nov Sun>=1 02:00 +00:00' },
].map(value => Object.freeze(value)));
