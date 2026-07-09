export function nextSampleId(current: string): string {
  return nextTrailingNumericId(current, "sample-001", "-002");
}

export function nextRepetitionId(current: string): string {
  return nextTrailingNumericId(current, "1", "-2");
}

function nextTrailingNumericId(current: string, fallback: string, suffixWhenNoNumber: string): string {
  const trimmed = current.trim();
  if (!trimmed) return fallback;

  const match = /^(.*?)(\d+)$/.exec(trimmed);
  if (!match) return `${trimmed}${suffixWhenNoNumber}`;

  const [, prefix, numeric] = match;
  const next = String(Number(numeric) + 1).padStart(numeric.length, "0");
  return `${prefix}${next}`;
}
