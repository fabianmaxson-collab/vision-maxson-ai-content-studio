import { z } from 'zod';
export * from './product';
export * from './editorial';
export * from './providers';

export const settingValueSchema = z.union([
  z.string().max(4096),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export const updateSettingSchema = z.object({ value: settingValueSchema });
export type SettingValue = z.infer<typeof settingValueSchema>;

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  requestId?: string;
}
