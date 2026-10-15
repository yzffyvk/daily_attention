export function questionSummaryFixture() {
  const evidence = '计划列出行动步骤，检查用于验证结果。';
  return {
    attention: '计划与检查', thesis: '先明确行动，再检查结果。', inspiration: '' as const,
    sourceTitle: '工作方法', warnings: [] as string[], distinctions: '建议阅读顺序不等于执行顺序。', prompts: ['检查如何改进计划？'],
    structure: {
      schemaVersion: 2 as const, coreQuestion: '如何安排并检查行动？', contentTypes: ['方法与决策规则' as const],
      questionOrder: ['q1', 'q2'],
      questions: [
        { id: 'q1', title: '如何安排？', answer: '计划列出行动步骤。', scope: '行动安排', mainlineRole: '明确行动', evidence,
          views: [{ id: 'v1', title: '行动安排', diagramKind: 'concepts' as const, nodeIds: ['n1'], relationIds: [], referenceNodeIds: [], readingOrder: ['n1'], contextNotes: [] }] },
        { id: 'q2', title: '如何检查？', answer: '检查验证结果并改进计划。', scope: '结果验证', mainlineRole: '验证行动', evidence,
          views: [{ id: 'v2', title: '验证结果', diagramKind: 'flow' as const, nodeIds: ['n2', 'n1'], relationIds: ['e1'], referenceNodeIds: ['n1'], readingOrder: ['n2', 'n1'], contextNotes: [{ nodeId: 'n1', text: '本题检查计划的结果。' }] }] },
      ],
      nodes: [
        { id: 'n1', homeQuestionId: 'q1', name: '计划', role: '方案' as const, summary: '安排步骤', explanation: '列出下一步行动。', evidence },
        { id: 'n2', homeQuestionId: 'q2', name: '检查', role: '机制' as const, summary: '验证结果', explanation: '检查实际结果，找出差距。', evidence },
      ],
      relations: [{ id: 'e1', from: 'n2', to: 'n1', kind: '反馈' as const, label: '验证并改进', condition: '获得结果后', evidence }],
      questionLinks: [{ fromQuestionId: 'q2', toQuestionId: 'q1', label: '检查结果用于改进计划', relationIds: ['e1'] }],
    },
  };
}
