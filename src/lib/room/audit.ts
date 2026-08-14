/**
 * Audit trail and moderation decisions for privileged actions.
 * Never stores private message content.
 */
import type { Db } from "./store";

export async function audit(
  db: Db,
  entry: {
    actorType?: "system" | "user" | "organization" | "platform_admin";
    actorId?: string | null;
    action: string;
    targetType?: string;
    targetId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await db.from("audit_logs").insert({
    actor_type: entry.actorType ?? "system",
    actor_id: entry.actorId ?? null,
    action: entry.action,
    target_type: entry.targetType ?? null,
    target_id: entry.targetId ?? null,
    metadata: entry.metadata ?? {},
  });
}

export async function recordModeration(
  db: Db,
  entry: {
    subjectType: "message" | "image" | "campaign" | "organization" | "room";
    subjectId: string;
    decision: "approved" | "rejected" | "escalated" | "suspended" | "appealed" | "restored";
    source?: "automated" | "human" | "appeal";
    reason?: string;
    reviewerAccountId?: string | null;
  },
) {
  await db.from("moderation_decisions").insert({
    subject_type: entry.subjectType,
    subject_id: entry.subjectId,
    decision: entry.decision,
    source: entry.source ?? "automated",
    reason: entry.reason ?? null,
    reviewer_account_id: entry.reviewerAccountId ?? null,
  });
}
