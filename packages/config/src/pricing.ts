import { z } from "zod";

/**
 * Prices are configuration, never code (PRICING_CONFIG env, JSON).
 * All money values are USD micros (1 USD = 1_000_000) to avoid floating point errors.
 */
export const PricingConfigSchema = z
  .object({
    /** What the customer is charged per audio minute, in USD micros. */
    customerPricePerAudioMinuteMicros: z.number().int().nonnegative(),
    /** Provider costs used for usage_events.cost (real cost). */
    providerCosts: z
      .object({
        asrPerAudioMinuteMicros: z.record(z.string(), z.number().int().nonnegative()),
        llmPerMillionInputTokensMicros: z.record(z.string(), z.number().int().nonnegative()),
        llmPerMillionOutputTokensMicros: z.record(z.string(), z.number().int().nonnegative()),
        embeddingsPerMillionTokensMicros: z.record(z.string(), z.number().int().nonnegative()),
      })
      .strict(),
    /** Warn the user when the balance drops below this many USD micros. */
    lowBalanceThresholdMicros: z.number().int().nonnegative(),
  })
  .strict();

export type PricingConfig = z.infer<typeof PricingConfigSchema>;

export function parsePricingConfig(raw: string): PricingConfig {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("PRICING_CONFIG is not valid JSON");
  }
  return PricingConfigSchema.parse(json);
}
