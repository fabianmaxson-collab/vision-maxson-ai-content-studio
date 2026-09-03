export const projectStatuses = [
  'DRAFT',
  'ANALYZING',
  'SCRIPT_REVIEW',
  'STORYBOARD_REVIEW',
  'PREFLIGHT_REVIEW',
  'GENERATING',
  'WAITING_APPROVAL',
  'PACKAGE_READY',
  'WAITING_FINAL_MASTER',
  'FINAL_MASTER_PROCESSING',
  'FINAL_REVIEW',
  'READY_TO_PUBLISH',
  'SCHEDULED',
  'PUBLISHING',
  'PUBLISHED',
  'PAUSED',
  'FAILED',
  'CANCELLED',
] as const;
export type ProjectStatus = (typeof projectStatuses)[number];
const transitions: Partial<Record<ProjectStatus, readonly ProjectStatus[]>> = {
  DRAFT: ['ANALYZING', 'PAUSED', 'CANCELLED'],
  ANALYZING: ['SCRIPT_REVIEW', 'FAILED', 'PAUSED', 'CANCELLED'],
  SCRIPT_REVIEW: ['STORYBOARD_REVIEW', 'ANALYZING', 'PAUSED', 'CANCELLED'],
  STORYBOARD_REVIEW: ['PREFLIGHT_REVIEW', 'SCRIPT_REVIEW', 'PAUSED', 'CANCELLED'],
  PREFLIGHT_REVIEW: ['GENERATING', 'STORYBOARD_REVIEW', 'PAUSED', 'CANCELLED'],
  GENERATING: ['WAITING_APPROVAL', 'FAILED', 'PAUSED'],
  WAITING_APPROVAL: ['PACKAGE_READY', 'GENERATING', 'PAUSED', 'CANCELLED'],
  PACKAGE_READY: ['WAITING_FINAL_MASTER', 'READY_TO_PUBLISH', 'PAUSED'],
  WAITING_FINAL_MASTER: ['FINAL_MASTER_PROCESSING', 'PAUSED', 'CANCELLED'],
  FINAL_MASTER_PROCESSING: ['FINAL_REVIEW', 'FAILED'],
  FINAL_REVIEW: ['READY_TO_PUBLISH', 'WAITING_FINAL_MASTER', 'PAUSED'],
  READY_TO_PUBLISH: ['SCHEDULED', 'PUBLISHING', 'PAUSED'],
  SCHEDULED: ['PUBLISHING', 'PAUSED', 'CANCELLED'],
  PUBLISHING: ['PUBLISHED', 'FAILED'],
  FAILED: ['DRAFT', 'PAUSED', 'CANCELLED'],
  PAUSED: ['DRAFT', 'CANCELLED'],
};
export function canTransitionProject(from: ProjectStatus, to: ProjectStatus): boolean {
  return transitions[from]?.includes(to) ?? false;
}
export function assertPhase2ProjectStatus(status: ProjectStatus): void {
  if (status !== 'DRAFT') throw new Error('phase_2_lifecycle_stage_unavailable');
}
export type ProjectFormat = 'SHORT' | 'LONG_FORM';
export function canDeriveProject(parent: ProjectFormat, child: ProjectFormat): boolean {
  return parent === 'LONG_FORM' && child === 'SHORT';
}
