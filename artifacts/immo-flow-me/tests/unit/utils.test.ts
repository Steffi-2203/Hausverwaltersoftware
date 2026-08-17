import { describe, it } from 'node:test';
import { expect } from '../helpers/expect';
import { roundMoney } from "../../shared/utils";

describe("roundMoney utility", () => {
  it("rounds to two decimals", () => {
    expect(roundMoney(1.234)).toBe(1.23);
    expect(roundMoney(1.235)).toBe(1.24);
    expect(roundMoney(1.004)).toBe(1.00);
    expect(roundMoney(0)).toBe(0);
  });

  it("handles negative values", () => {
    expect(roundMoney(-1.234)).toBe(-1.23);
    expect(roundMoney(-1.236)).toBe(-1.24);
  });

  it("handles NaN as 0", () => {
    expect(roundMoney(NaN)).toBe(0);
  });

  it("handles large numbers", () => {
    expect(roundMoney(999999.999)).toBe(1000000.0);
    expect(roundMoney(123456.785)).toBe(123456.79);
  });
});
