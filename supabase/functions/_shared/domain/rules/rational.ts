import type { ExactRational } from './types.ts';
const gcd = (a: bigint, b: bigint): bigint => { a = a < 0n ? -a : a; b = b < 0n ? -b : b; while (b) [a, b] = [b, a % b]; return a || 1n; };
/** Exact internal arithmetic. JSON boundaries contain decimal strings, never BigInt values. */
export class Rational {
  readonly n: bigint; readonly d: bigint;
  constructor(n: bigint | number, d: bigint | number = 1) {
    let a = BigInt(n), b = BigInt(d); if (!b) throw new RangeError('ZERO_DENOMINATOR');
    if (b < 0n) { a = -a; b = -b; } const divisor = gcd(a, b); this.n = a / divisor; this.d = b / divisor;
  }
  add(other: Rational) { return new Rational(this.n * other.d + other.n * this.d, this.d * other.d); }
  sub(other: Rational) { return new Rational(this.n * other.d - other.n * this.d, this.d * other.d); }
  mul(other: Rational) { return new Rational(this.n * other.n, this.d * other.d); }
  div(other: Rational) { return new Rational(this.n * other.d, this.d * other.n); }
  compare(other: Rational) { const delta = this.n * other.d - other.n * this.d; return delta < 0n ? -1 : delta > 0n ? 1 : 0; }
  clamp(low: Rational, high: Rational) { return this.compare(low) < 0 ? low : this.compare(high) > 0 ? high : this; }
  number() { return Number(this.n) / Number(this.d); }
  toJSON(): ExactRational { return { numerator: String(this.n), denominator: String(this.d) }; }
}
export const q = (n: number | bigint, d: number | bigint = 1) => new Rational(n, d);
export const fromExact = (value: ExactRational) => new Rational(BigInt(value.numerator), BigInt(value.denominator));
export const sum = (values: readonly Rational[]) => values.reduce((total, value) => total.add(value), q(0));
export function fromDecimal(value: number): Rational {
  if (!Number.isFinite(value)) throw new RangeError('NON_FINITE_RATIONAL');
  const [mantissa, exponent = '0'] = value.toString().toLowerCase().split('e');
  const negative = mantissa!.startsWith('-'); const unsigned = mantissa!.replace('-', '');
  const [whole, fraction = ''] = unsigned.split('.'); const shift = Number(exponent) - fraction.length;
  let numerator = BigInt(`${whole}${fraction}`); let denominator = 1n;
  if (shift >= 0) numerator *= 10n ** BigInt(shift); else denominator = 10n ** BigInt(-shift);
  return new Rational(negative ? -numerator : numerator, denominator);
}
