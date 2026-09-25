// Keep long model requests, queue ownership, and graceful shutdown in sync.
// The lease also covers source fetching and the database calls around generation.
export const dedicatedAiTiming = {
  modelTimeoutMs: 300_000,
  queueVisibilitySeconds: 420,
  shutdownTimeoutMs: 400_000,
} as const;
