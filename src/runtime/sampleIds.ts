export function nextSampleId(current: string): string {
  const trimmed = current.trim();
  if (!trimmed) return "sample-001";

  const match = /^(.*?)(\d+)$/.exec(trimmed);
  if (!match) return `${trimmed}-002`;

  const [, prefix, numeric] = match;
  const next = String(Number(numeric) + 1).padStart(numeric.length, "0");
  return `${prefix}${next}`;
}
