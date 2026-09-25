export const relationSource = '上下文包含系统提示词和消息历史。KV Cache 复用稳定前缀以减少重复计算。压缩替换较早的消息历史，改写位置之后的缓存会失效。';
export function relationSummaryFixture() {
  return {
    attention: '上下文的组织与管理', thesis: '组织信息，并权衡缓存复用和历史压缩。',
    structure: {
      coreQuestion: '如何在有限窗口内提供有效上下文？', contentTypes: ['组成与分类', '问题与解决方案'],
      nodes: [
        { name: '上下文', role: '对象', summary: '每次决策可见的信息', explanation: '系统提示词与消息历史共同构成上下文。', evidence: '上下文包含系统提示词和消息历史' },
        { name: '消息历史', role: '组成', summary: '持续增长的交互记录', explanation: '历史承载用户输入和工具结果。', evidence: '消息历史' },
        { name: 'KV Cache', role: '机制', summary: '复用计算', explanation: '复用稳定前缀的计算结果。', evidence: 'KV Cache 复用稳定前缀以减少重复计算' },
        { name: '上下文压缩', role: '机制', summary: '精简历史', explanation: '替换较早的消息历史，并保留必要信息。', evidence: '压缩替换较早的消息历史' },
      ],
      relations: [
        { from: '上下文', to: '消息历史', kind: '包含', label: '包含', condition: '', evidence: '上下文包含系统提示词和消息历史' },
        { from: '上下文压缩', to: '消息历史', kind: '作用', label: '精简与重组', condition: '需要保留任务信息', evidence: '压缩替换较早的消息历史' },
        { from: '上下文压缩', to: 'KV Cache', kind: '权衡', label: '权衡长度与缓存复用', condition: '改写位置之后的缓存失效', evidence: '改写位置之后的缓存会失效' },
      ],
      readingOrder: ['上下文', 'KV Cache', '上下文压缩'],
    },
    distinctions: '缓存复用计算，压缩改变内容。', prompts: ['为什么已有 KV Cache 仍然需要压缩？'],
    inspiration: '', sourceTitle: '上下文工程', warnings: [],
  };
}
