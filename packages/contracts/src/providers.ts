import { z } from 'zod';

export const providerModelAvailabilityStatusSchema = z.enum(['inactive', 'available']);
export type ProviderModelAvailabilityStatus = z.infer<typeof providerModelAvailabilityStatusSchema>;

export const providerModelStatusTransitionSchema = z
  .object({
    expectedStatus: providerModelAvailabilityStatusSchema,
    targetStatus: providerModelAvailabilityStatusSchema,
    version: z.number().int().positive(),
  })
  .strict()
  .refine((value) => value.expectedStatus !== value.targetStatus, {
    message: 'Expected and target status must differ.',
  });
export type ProviderModelStatusTransition = z.infer<typeof providerModelStatusTransitionSchema>;
