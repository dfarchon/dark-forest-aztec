export function formatTime(timestamp: number): string {
  const iso = new Date(timestamp * 1000).toISOString();
  return `${iso.slice(0, 19).replace("T", " ")} UTC`;
}

export function formatSilver(value: string): string {
  const negative = value.startsWith("-");
  const digits = negative ? value.slice(1) : value;
  if (!/^\d+$/.test(digits)) return value;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return negative ? `-${grouped}` : grouped;
}

export function silverNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function compact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(1)}t`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(1)}b`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}m`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
  return String(Math.round(value));
}

export function shortAddress(value: string): string {
  if (value.length <= 13) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function bucketLabel(seconds: number): string {
  if (seconds === 3600) return "Hourly";
  if (seconds === 86400) return "Daily";
  return `${seconds}s buckets`;
}
