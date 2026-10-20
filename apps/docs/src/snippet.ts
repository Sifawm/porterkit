const marker = /^\s*\/\/ #(end)?region\b.*\n/gm;

/** The lines between `// #region name` and `// #endregion` of a snippet, or the whole file without its markers. */
export function snippet(source: string, region?: string): string {
  if (!region) return source.replace(marker, '').trim();
  const match = source.match(new RegExp(`// #region ${region}\\n([\\s\\S]*?)\\n\\s*// #endregion`));
  if (!match) throw new Error(`No region "${region}" in snippet`);
  const lines = match[1].replace(marker, '').split('\n');
  const indent = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
  return lines.map((l) => l.slice(indent)).join('\n');
}
