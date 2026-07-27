import { describe, it, expect } from 'vitest';
import { daysUntilExpiry, expiryUrgency } from './expiry';

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('daysUntilExpiry', () => {
  it('returns 0 for today', () => {
    expect(daysUntilExpiry(isoDaysFromNow(0))).toBe(0);
  });

  it('returns a positive count for a future date', () => {
    expect(daysUntilExpiry(isoDaysFromNow(10))).toBe(10);
  });

  it('returns a negative count for a past date', () => {
    expect(daysUntilExpiry(isoDaysFromNow(-5))).toBe(-5);
  });
});

describe('expiryUrgency', () => {
  it('is "expired" once past the expiry date', () => {
    expect(expiryUrgency(-1)).toBe('expired');
  });

  it('is "critical" within a week, including exactly 7 days', () => {
    expect(expiryUrgency(0)).toBe('critical');
    expect(expiryUrgency(7)).toBe('critical');
  });

  it('is "warning" between a week and a month out', () => {
    expect(expiryUrgency(8)).toBe('warning');
    expect(expiryUrgency(30)).toBe('warning');
  });

  it('is "ok" beyond a month out', () => {
    expect(expiryUrgency(31)).toBe('ok');
  });
});
