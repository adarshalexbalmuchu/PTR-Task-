// Whole days between today and an item batch's expiry date — negative once
// past expiry. Compares at day granularity (not exact hours) since
// expiry_date is a plain date column, not a timestamp.
export function daysUntilExpiry(expiryDate: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(`${expiryDate}T00:00:00`);
  return Math.round((expiry.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

export type ExpiryUrgency = 'expired' | 'critical' | 'warning' | 'ok';

// critical: expires within a week — needs action now. warning: within a
// month — worth planning around. Thresholds match the red/amber banding
// already used for task due dates (isOverdue / formatDueRelative).
export function expiryUrgency(daysLeft: number): ExpiryUrgency {
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 7) return 'critical';
  if (daysLeft <= 30) return 'warning';
  return 'ok';
}
