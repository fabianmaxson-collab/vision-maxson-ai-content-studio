import { describe, expect, it } from 'vitest';
import { calculateKnownCost, calculateUsageMicrousd } from './intelligence';

describe('exact decimal micro-USD accounting', () => {
  it('reproduces and removes the real canonical binary floating-point extra micro', () => {
    expect(Math.ceil(0.016188 * 1_000_000)).toBe(16189);
    expect(calculateUsageMicrousd(630, 0, 0.000002, 0.000012)).toBe(1260);
    expect(calculateUsageMicrousd(0, 1244, 0.000002, 0.000012)).toBe(14928);
    expect(calculateUsageMicrousd(630, 1244, 0.000002, 0.000012)).toBe(16188);
    expect(calculateKnownCost(630, 1244, 0.000002, 0.000012)).toBe(0.016188);
  });
  it.each([
    [1, 0.0000001, 1], // $0.10/M: ceil exact .1 micro
    [1, 0.00000025, 1], // $0.25/M: ceil exact .25 micro
    [3, 0.00000025, 1], // ceil exact .75 micro
    [4, 0.00000025, 1], // exact integer
    [1, 0.0000015, 2], // $1.50/M
    [2, 0.0000015, 3],
    [1, 0.000012, 12], // $12/M
    [1, 1e-12, 1],
    [1_000_000_000, 0.0000001, 100_000_000],
    [0, 0.000012, 0],
    [Number.MAX_SAFE_INTEGER, 0.000001, Number.MAX_SAFE_INTEGER],
  ])('prices %s units at %s USD per unit as %s micro-USD', (units, rate, expected) => {
    expect(calculateUsageMicrousd(units, 0, rate, 0)).toBe(expected);
  });
  it('rounds the exact combined total once, not each component', () => {
    expect(calculateUsageMicrousd(1, 1, 0.00000025, 0.00000025)).toBe(1);
  });
  it('discounts cached input without charging it again and includes reasoning in output', () => {
    expect(calculateUsageMicrousd(10, 20, 0.000002, 0.000012, 4, 0.0000002, 15)).toBe(253);
    expect(calculateUsageMicrousd(10, 20, 0.000002, 0.000012, 4, null, 15)).toBe(260);
  });
  it.each([-1, NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid units %s',
    (value) => {
      expect(calculateUsageMicrousd(value, 0, 1, 1)).toBeNull();
      expect(calculateUsageMicrousd(0, value, 1, 1)).toBeNull();
      expect(calculateUsageMicrousd(10, 10, 1, 1, value)).toBeNull();
      expect(calculateUsageMicrousd(10, 10, 1, 1, 0, null, value)).toBeNull();
    },
  );
  it.each([-1, NaN, Infinity, -Infinity])('rejects invalid prices %s', (value) => {
    expect(calculateUsageMicrousd(1, 1, value, 1)).toBeNull();
    expect(calculateUsageMicrousd(1, 1, 1, value)).toBeNull();
    expect(calculateUsageMicrousd(1, 1, 1, 1, 1, value)).toBeNull();
  });
  it('keeps missing accounting unknown and rejects invalid subsets and overflow', () => {
    expect(calculateUsageMicrousd(null, 1, 1, 1)).toBeNull();
    expect(calculateUsageMicrousd(1, null, 1, 1)).toBeNull();
    expect(calculateUsageMicrousd(1, 1, null, 1)).toBeNull();
    expect(calculateUsageMicrousd(1, 1, 1, null)).toBeNull();
    expect(calculateUsageMicrousd(1, 1, 1, 1, 2)).toBeNull();
    expect(calculateUsageMicrousd(1, 1, 1, 1, 0, null, 2)).toBeNull();
    expect(calculateUsageMicrousd(Number.MAX_SAFE_INTEGER, 0, 1, 0)).toBeNull();
    expect(calculateUsageMicrousd(1, 0, Number.MAX_VALUE, 0)).toBeNull();
  });
});
