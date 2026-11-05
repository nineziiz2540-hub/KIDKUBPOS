// Pure rules for queue numbers handed out by the device while offline.
// The date is the Bangkok date, from bangkokToday(new Date(ms)).
export type QueueState = { date: string; last: number };

/** Record a queue number seen from the server (or the device). */
export function observeQueue(s: QueueState | null, date: string, n: number): QueueState {
  if (!s || s.date !== date) return { date, last: n };
  return { date, last: Math.max(s.last, n) };
}

/** The next device-numbered queue number; a new date starts at 1. */
export function nextDeviceQueue(
  s: QueueState | null,
  date: string,
): { number: number; state: QueueState } {
  const last = s && s.date === date ? s.last : 0;
  const number = last + 1;
  return { number, state: { date, last: number } };
}
