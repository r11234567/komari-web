// Time windows are bounded by actual metric retention; longer history grows
// in 15-day steps, with a final nonstandard retention window when needed.
export const chartWindowHours = (retentionDays: number): number[] => {
  const days = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 0;
  const limit = days * 24;
  const hours = [1, 6, 12, 24, 7 * 24].filter(value => value <= limit);
  for (let day = 15; day <= days; day += 15) hours.push(day * 24);
  if (limit > 0 && !hours.includes(limit)) hours.push(limit);
  return hours.sort((a, b) => a - b);
};

export const chartTargetPoints = (hours: number): number => {
  if (hours === 75 * 24) return 300;
  if (hours === 90 * 24) return 309;
  return 360;
};
