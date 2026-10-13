import { expect, it } from 'vitest';
import { checkInInputSchema } from '@/lib/domain/checkin';
import { aiGenerationResultSchema } from '@/lib/domain/ai-generation';
import { aiGenerationResultSchema as workerResultSchema } from '@/supabase/functions/_shared/ai/contracts';
import { narrativeSourceSchema } from '@/lib/domain/knowledge-narrative';
import { reflectionPolishInputSchema } from '@/lib/domain/reflection-polish';

it('preserves long summaries across saving, generated jobs, narratives and polishing', () => {
  const schemas = [checkInInputSchema.shape.summary, aiGenerationResultSchema.shape.summary, workerResultSchema.shape.summary, narrativeSourceSchema.shape.summary, reflectionPolishInputSchema.shape.summary];
  for (const schema of schemas) {
    expect(schema.parse('知'.repeat(30000))).toBe('知'.repeat(30000));
  }
});
