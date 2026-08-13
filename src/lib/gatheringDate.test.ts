import { describe, expect, it } from 'vitest';
import { formatDubaiDateKey, formatDubaiDateTime, toDubaiIso } from './gatheringDate';

describe('gathering date mapping', () => {
  it('creates an offset-bearing Dubai timestamp independent of browser timezone', () => {
    expect(toDubaiIso('2026-12-02', '18:30')).toBe('2026-12-02T18:30:00+04:00');
    expect(new Date(toDubaiIso('2026-12-02', '18:30')).toISOString()).toBe('2026-12-02T14:30:00.000Z');
  });

  it('maps an instant back to its Dubai calendar date', () => {
    expect(formatDubaiDateKey('2026-12-01T21:30:00.000Z')).toBe('2026-12-02');
  });

  it('rejects impossible dates and invalid times', () => {
    expect(() => toDubaiIso('2026-02-31', '14:00')).toThrow('real calendar date');
    expect(() => toDubaiIso('2026-02-20', '25:00')).toThrow('valid date and time');
  });

  it('formats in UAE time with the supplied instant', () => {
    const formatted = formatDubaiDateTime('2026-12-02T18:30:00+04:00', 'short');
    expect(formatted).toContain('2026');
    expect(formatted).toMatch(/6:30|18:30/);
  });
});
