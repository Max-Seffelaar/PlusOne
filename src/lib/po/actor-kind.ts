/**
 * Who did it, as a TYPE — not as text (spec #64(a), review #466 rounds 3–4).
 *
 * Only `member` carries user-controlled text (a person's own full_name). The
 * other kinds are PlusOne's own labels and every surface renders them as a
 * CHIP (kit `ActorName`: bordered pill, icon, screen-reader hint); a member's
 * name is always plain text. What that guarantees: the label is always in a
 * chip and a name never is. A name can still LOOK like the label text (a
 * styled look-alike); it then reads as plain text next to the real chip. That
 * structural rule is the primary guarantee; the reserved-name CHECK
 * (20261016140100) is defence in depth.
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
