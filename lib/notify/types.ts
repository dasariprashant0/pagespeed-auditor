export type NotificationEvent = 'sweep.completed' | 'sweep.failed';

export interface SweepSummary {
  runId: string;
  siteName: string;
  event: NotificationEvent;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  durationMinutes: number | null;
  averagePerformance: number | null;
  previousAveragePerformance: number | null;
  worstPages: Array<{ url: string; score: number | null }>;
  dashboardUrl: string;
  error?: string | null;
}
