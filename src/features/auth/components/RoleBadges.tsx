import { ROLE_LABELS, type VenueRole } from '../roles';

// Presentational only (renders server-side). One lavender-free chip per role,
// using the elevated surface + line tokens (design-system.md).
export function RoleBadges({ roles }: { roles: readonly VenueRole[] }): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5">
      {roles.map((role) => (
        <span
          key={role}
          className="bg-elev2 border-line text-dim rounded-full border px-2.5 py-1 text-xs font-semibold"
        >
          {ROLE_LABELS[role]}
        </span>
      ))}
    </div>
  );
}
