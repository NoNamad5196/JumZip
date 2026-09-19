/** Treat an explicit request not to remember this exchange as a private memory turn. */
export function hasMemoryOptOut(message: string): boolean {
  return /(?:기억|저장|남기|요약).{0,8}(?:하지\s*마|하진\s*마|말아|않|금지)|기억\s*안\s*했으면|잊어\s*줘|don't\s+(?:remember|save)|do\s+not\s+(?:remember|save)|forget\s+(?:this|that|it|me)/i.test(message);
}
