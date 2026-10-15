import { describe, expect, it } from 'vitest';
import { questionFrameworkSchema } from '@/supabase/functions/_shared/ai/question-framework';

describe('framework content boundaries', () => {
  it.each([
    ['控制揭示时机', '延迟揭示', '把谜底留到终章揭示，持续维持阅读悬念。'],
    ['运用基础知识检验假设', '假设检验', '利用已知原则判断假设是否成立。'],
  ])('allows actual subject matter about %s rather than rejecting it by a keyword', (mainlineRole, name, summary) => {
    expect(questionFrameworkSchema.safeParse({ attention: '学习资料', thesis: '围绕核心问题组织依据。', coreQuestion: '如何解释核心原理？', parts: [{ id: 'p1', mainlineRole, title: '怎样起作用？', scope: '原理与条件', evidence: 'S0001', concepts: [{ id: 'c1', name, summary, evidence: 'S0001' }] }] }).success).toBe(true);
  });
});
