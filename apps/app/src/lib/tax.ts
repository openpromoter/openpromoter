/** IRS Form 1099-NEC reporting threshold by payment year (irs.gov; OBBBA raised it for 2026). */
export function nec1099Threshold(year: number): number {
  return year >= 2026 ? 200_000 : 60_000;
}
