import { expect, it } from 'vitest';
import { checkInInputSchema } from '@/lib/domain/checkin';
import { aiGenerationResultSchema } from '@/lib/domain/ai-generation';
import { aiGenerationResultSchema as workerResultSchema } from '@/supabase/functions/_shared/ai/contracts';
import { narrativeSourceSchema } from '@/lib/domain/knowledge-narrative';

it('accepts 12000-character summaries across saving, jobs and narrative reuse, and rejects 12001', () => {
  const schemas = [checkInInputSchema.shape.summary, aiGenerationResultSchema.shape.summary, workerResultSchema.shape.summary, narrativeSourceSchema.shape.summary];
  for (const schema of schemas) {
    expect(schema.safeParse('知'.repeat(12000)).success).toBe(true);
    expect(schema.safeParse('知'.repeat(12001)).success).toBe(false);
  }
});
