/**
 * Partial approval (z8uq9m0hw6): the approve sheet's decision → the server
 * action's input. Pure, so the one rule that matters here is unit-testable:
 * the approved count is clamped to 0..requested, and it and the message are
 * sent ONLY when they change something. A plain approval therefore stays the
 * 2-arg RPC call, which the pre-migration function resolves too. The RPC is
 * still the boundary; this only keeps the UI from asking for the impossible.
 */
import type { ApproveGuestRequestInput } from './schemas';

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
