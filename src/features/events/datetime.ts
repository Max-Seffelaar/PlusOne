// datetime-local <-> ISO conversion, in the browser's wall-clock (Europe/
// Amsterdam for NL venues). An event 23:00→05:00 becomes two full instants and
// crosses midnight by construction (#26). Shared by the event form and the
// auto-lock scheduler.

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO instant -> 'YYYY-MM-DDTHH:mm' local string for DateTimeField, or ''. */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 'YYYY-MM-DDTHH:mm' local string -> ISO instant, or null when empty/invalid. */
export function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
