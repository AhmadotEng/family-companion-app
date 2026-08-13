const DUBAI_OFFSET = '+04:00';

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Turns the planner's wall-clock fields into an offset-bearing ISO timestamp.
 * The UAE currently has a fixed UTC+04:00 civil time and no daylight-saving
 * transition, so this remains deterministic even when the browser is elsewhere.
 */
export function toDubaiIso(date: string, time: string): string {
  if (!datePattern.test(date) || !timePattern.test(time)) {
    throw new Error('Choose a valid date and time.');
  }

  const timestamp = `${date}T${time}:00${DUBAI_OFFSET}`;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) throw new Error('Choose a valid date and time.');

  const [year, month, day] = date.split('-').map(Number);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    // At +04:00 the UTC date can be the previous day, so compare through a
    // formatter below instead of accepting rollover such as 2026-02-31.
    const reconstructed = formatDubaiDateKey(parsed);
    if (reconstructed !== date) throw new Error('Choose a real calendar date.');
  }

  if (formatDubaiDateKey(parsed) !== date) throw new Error('Choose a real calendar date.');
  return timestamp;
}

const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Dubai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function formatDubaiDateKey(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '';
  const parts = dateKeyFormatter.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function formatDubaiDateTime(value: string, style: 'short' | 'long' = 'long'): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Invalid date';
  return new Intl.DateTimeFormat('en-AE', {
    timeZone: 'Asia/Dubai',
    dateStyle: style === 'long' ? 'full' : 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function dubaiTodayKey(now = new Date()): string {
  return formatDubaiDateKey(now);
}
