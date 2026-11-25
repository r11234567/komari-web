export function quoteShellArg(value: string) {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

export function quotePowerShellArg(value: string) {
  return "'" + value.replace(/['‘’‚‛]/g, (quote) => quote + quote) + "'";
}
