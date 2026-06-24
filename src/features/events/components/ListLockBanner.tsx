// Banner shown on every guest-list screen while a list is locked (#23). Pure
// presentational — the lock itself is enforced by RLS (can_write_guests); this
// just explains it. `youAreBlocked` switches to the staff-facing copy (a staff
// member whose mutations RLS will reject).

export function ListLockBanner({
  locked,
  youAreBlocked = false,
}: {
  locked: boolean;
  youAreBlocked?: boolean;
}): JSX.Element | null {
  if (!locked) return null;

  return (
    <div
      role="status"
      className="rounded-card border border-acc bg-acc-dim p-3 text-sm"
    >
      <p className="text-text font-semibold">List locked</p>
      <p className="text-dim mt-0.5">
        {youAreBlocked
          ? "You can't add or change guests right now. Ask an admin, organizer, or door host to unlock the list."
          : 'Only an admin, organizer, or door host can make changes now.'}
      </p>
    </div>
  );
}
