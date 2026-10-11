/**
 * Partial approval (z8uq9m0hw6): the approve sheet's decision → the server
 * action's input. Pure, so the one rule that matters here is unit-testable:
 * the approved count is clamped to 0..requested, and it and the message are
 * sent ONLY when they change something. A plain approval therefore stays the
 * 2-arg RPC call, which the pre-migration function resolves too. The RPC is
 * still the boundary; this only keeps the UI from asking for the impossible.
 */
import type { ApproveGuestRequestInput, DecideGuestRequestInput } from './schemas';

/** A stepper value clamped to 0..requested plus-ones (whole numbers only). */
export function clampApprovedPlusOnes(value: number, requested: number): number {
  const max = Math.max(0, Math.floor(requested));
  if (!Number.isFinite(value)) return max;
  return Math.min(Math.max(0, Math.round(value)), max);
}

export interface ApprovalDecision {
  tierId: string;
  /** Plus-ones to approve; clamped to 0..requested. */
  plusOnes: number;
  /** Raw textarea value; trimmed here, blank = no message. */
  message: string;
}

export function buildApproveInput(
  req: { id: string; eventId: string; plus: number },
  decision: ApprovalDecision,
): ApproveGuestRequestInput {
  const plusOnes = clampApprovedPlusOnes(decision.plusOnes, req.plus);
  const message = decision.message.trim();
  return {
    requestId: req.id,
    tierId: decision.tierId,
    eventId: req.eventId,
    ...(plusOnes < req.plus ? { plusOnes } : {}),
    ...(message.length > 0 ? { message } : {}),
  };
}

/**
 * Requests E (z8uq9m2vga): the decision sheet's state → the decide action's
 * input. People per tier (0 = that tier is not used); whoever is not placed on
 * a tier is declined. Pure, so the arithmetic the RPC re-checks is unit-tested
 * here too: every count is clamped so the parts never exceed the request.
 */
export interface SplitDecision {
  /** People per tier, in the order the sheet shows the tiers. */
  parts: { tierId: string; people: number }[];
  /** Raw textarea value; trimmed here, blank = no note. */
  note: string;
}

/** People placed on tiers, each part clamped to 0.., the whole to the request. */
export function placedPeople(parts: SplitDecision['parts'], requestedHeads: number): number {
  const sum = parts.reduce((acc, p) => acc + Math.max(0, Math.floor(p.people) || 0), 0);
  return Math.min(sum, requestedHeads);
}

export function buildDecideInput(
  req: { id: string; eventId: string; plus: number },
  decision: SplitDecision,
): DecideGuestRequestInput {
  const requested = 1 + Math.max(0, Math.floor(req.plus));
  let left = requested;
  const approved: { tierId: string; plusOnes: number }[] = [];
  for (const part of decision.parts) {
    const people = Math.min(Math.max(0, Math.floor(part.people) || 0), left);
    if (people === 0) continue;
    approved.push({ tierId: part.tierId, plusOnes: people - 1 });
    left -= people;
  }
  const note = decision.note.trim();
  return {
    requestId: req.id,
    eventId: req.eventId,
    approved,
    declined: left,
    ...(note.length > 0 ? { note } : {}),
  };
}

/** Decline a whole request: everyone declined, the note (mandatory) to the guest. */
export function buildDeclineInput(req: { id: string; eventId: string; plus: number }, note: string): DecideGuestRequestInput {
  return buildDecideInput(req, { parts: [], note });
}
