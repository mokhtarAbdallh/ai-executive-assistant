import { z } from "zod";

/**
 * Analysis JSON — the contract between the LLM, the database and the UI (ADR-011).
 *
 * Invariant 2: every topic/decision/action item cites its source
 *   (`sourceTs` + at least one `sourceSegmentIds` entry).
 * Invariant 3: unknown owner/due stay `null` and MUST be flagged `needsReview`.
 */

/** "mm:ss" or "hh:mm:ss" offset into the recording. */
export const SourceTsSchema = z
  .string()
  .regex(/^(\d{1,2}:)?[0-5]?\d:[0-5]\d$/, "sourceTs must be mm:ss or hh:mm:ss");

const sourceFields = {
  sourceTs: SourceTsSchema,
  sourceSegmentIds: z.array(z.string().min(1)).min(1, "at least one source segment id is required"),
};

const nonEmpty = z.string().trim().min(1);

/** ISO date (YYYY-MM-DD) or full ISO datetime with offset. */
const IsoDateOrDateTime = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  z.string().datetime({ offset: true }),
]);

export const TopicSchema = z
  .object({
    title: nonEmpty,
    summary: nonEmpty,
    ...sourceFields,
  })
  .strict();

export const DecisionSchema = z
  .object({
    text: nonEmpty,
    ...sourceFields,
    needsReview: z.boolean(),
  })
  .strict();

export const PrioritySchema = z.enum(["low", "medium", "high"]);

export const ActionItemSchema = z
  .object({
    task: nonEmpty,
    owner: nonEmpty.nullable(),
    due: IsoDateOrDateTime.nullable(),
    priority: PrioritySchema.nullable(),
    ...sourceFields,
    needsReview: z.boolean(),
  })
  .strict()
  .refine((item) => (item.owner !== null && item.due !== null) || item.needsReview, {
    message: "action items with unknown owner or due date must have needsReview=true",
    path: ["needsReview"],
  });

export const NextMeetingSchema = z
  .object({
    proposedDatetime: z.string().datetime({ offset: true }).nullable(),
    place: nonEmpty.nullable(),
    /** The analysis can only ever propose; booking happens via an approved Proposal. */
    status: z.literal("pending_confirmation"),
  })
  .strict();

export const MeetingAnalysisSchema = z
  .object({
    meta: z
      .object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
        time: z.string().regex(/^\d{2}:\d{2}$/, "expected HH:mm"),
        language: z.enum(["ar", "en", "mixed"]),
        participants: z.array(nonEmpty),
      })
      .strict(),
    tldr: nonEmpty,
    purpose: z.string().trim(),
    agenda: z.array(nonEmpty),
    topics: z.array(TopicSchema),
    decisions: z.array(DecisionSchema),
    actionItems: z.array(ActionItemSchema),
    openQuestions: z.array(nonEmpty),
    nextMeeting: NextMeetingSchema.nullable(),
    documents: z.array(nonEmpty),
  })
  .strict();

export type Topic = z.infer<typeof TopicSchema>;
export type Decision = z.infer<typeof DecisionSchema>;
export type ActionItem = z.infer<typeof ActionItemSchema>;
export type NextMeeting = z.infer<typeof NextMeetingSchema>;
export type MeetingAnalysis = z.infer<typeof MeetingAnalysisSchema>;
