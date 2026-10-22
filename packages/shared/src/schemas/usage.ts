import { z } from "zod";

/** Every paid operation writes one usage_events row with real cost (Invariant 7). */
export const UsageKindSchema = z.enum([
  "asr_audio_seconds",
  "llm_input_tokens",
  "llm_output_tokens",
  "embedding_tokens",
]);
export type UsageKind = z.infer<typeof UsageKindSchema>;

export const UsageEventInputSchema = z
  .object({
    userId: z.string().min(1),
    meetingId: z.string().min(1).nullable(),
    kind: UsageKindSchema,
    quantity: z.number().int().nonnegative(),
    provider: z.string().min(1),
    model: z.string().min(1).nullable(),
    /** Real provider cost in USD micros (1 USD = 1_000_000). */
    costMicros: z.number().int().nonnegative(),
  })
  .strict();
export type UsageEventInput = z.infer<typeof UsageEventInputSchema>;
