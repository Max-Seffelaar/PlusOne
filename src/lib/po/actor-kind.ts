/**
 * Who did it, as a TYPE — not as text (spec #62(a), review #466 round 3).
 *
 * Only `member` carries user-controlled text (a person's own full_name). The
 * other kinds are PlusOne's own labels and every surface renders them
 * distinctly from a name (kit `ActorName`: muted, italic, an icon), so no
 * name — "System", "PlusOne support", a look-alike, or a name padded with an
 * invisible character — can ever pass for one of them. That structural rule is
 * the primary guarantee; the reserved-name CHECK is defence in depth.
 *
 *   member   a current or former member/crew (their name)
 *   support  a PlusOne platform admin without a tie to the company
 *   system   no actor at all (a database/system action, a request-link sign-up)
 *   unknown  an actor id the screen could not resolve (labels unavailable)
 *   unnamed  a member whose name is blank after normalisation
 */
export type ActorKind = 'member' | 'support' | 'system' | 'unknown' | 'unnamed';

/** The export's actor-type cell (`*_type` columns): member | plusone_support | system | unknown.
 *  A blank-named member is still a member. */
export function actorKindCsv(kind: ActorKind): 'member' | 'plusone_support' | 'system' | 'unknown' {
  switch (kind) {
    case 'support':
      return 'plusone_support';
    case 'system':
      return 'system';
    case 'unknown':
      return 'unknown';
    default:
      return 'member';
  }
}
