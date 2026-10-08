// Stand-in for upstream's `~/i18n` extension-UI-string localisation module.
// Vendored code only uses this for error/prompt message strings; this CLI
// has no UI to localise, so `t()` is a passthrough that returns the key
// (optionally with naive `%s`-style interpolation of extra args appended).

function t(key: string, ...args: unknown[]): string {
  if (args.length === 0)
    return key
  return `${key} ${args.map(a => String(a)).join(' ')}`
}

export default { t }
