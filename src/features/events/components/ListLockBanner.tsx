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
      <p className="text-text font-semibold">Lijst vergrendeld</p>
      <p className="text-dim mt-0.5">
        {youAreBlocked
          ? 'Je kunt nu geen gasten toevoegen of wijzigen. Vraag een admin, organisator of doorhost om de lijst te ontgrendelen.'
          : 'Alleen admin, organisator en doorhost kunnen nog wijzigen.'}
      </p>
    </div>
  );
}
