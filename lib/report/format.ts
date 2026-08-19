import type { Bucket, MetricId } from '../psi/types.ts';
import { BUCKET_LABEL } from '../psi/buckets.ts';

/**
 * Value formatting that matches how pagespeed.web.dev writes numbers, so a
 * report read here and a report read there agree at a glance.
 */

/** Sub-second stays in ms; above that, seconds to one decimal. PSI's own rule. */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/** CLS is unitless and conventionally shown to 2-3 dp. */
export function formatUnitless(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return v.toFixed(v < 0.01 && v > 0 ? 3 : 2);
}

export function formatMetric(metric: MetricId | 'tbt', value: number | null | undefined): string {
  return metric === 'cls' ? formatUnitless(value) : formatMs(value);
}

export function formatBucket(b: Bucket | null): string {
  return b ? BUCKET_LABEL[b] : '—';
}

export function formatScore(score: number | null | undefined): string {
  return score === null || score === undefined ? '—' : String(score);
}

/**
 * Delta against the previous audit. Returns an em-dash when there is no prior
 * run or no change -- an arrow implying movement where there was none is worse
 * than saying nothing.
 */
export function formatDelta(current: number | null, previous: number | null | undefined): string {
  if (current === null || previous === null || previous === undefined) return '—';
  const d = current - previous;
  if (d === 0) return '—';
  return d > 0 ? `▲ ${d}` : `▼ ${Math.abs(d)}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * Markdown table cells cannot contain a raw pipe, and audit descriptions
 * routinely do (they embed links and code). Escape rather than strip, so the
 * text stays readable.
 */
export function escapeCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/** ISO-8601 in UTC, second precision. Stable across machines and locales. */
export function formatTimestamp(d: Date): string {
  return `${d.toISOString().slice(0, 19).replace('T', ' ')} UTC`;
}
