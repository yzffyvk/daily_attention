// Keep long model requests, queue ownership, and graceful shutdown in sync.
// The lease also covers source fetching and the database calls around generation.
export const dedicatedAiTiming = {
  // Includes planning, writing, semantic review/revision and one shared format repair.
  modelTimeoutMs: 480_000,
  queueVisibilitySeconds: 600,
  shutdownTimeoutMs: 580_000,
} as const;
