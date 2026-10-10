import { describe, expect, it } from 'vitest';
import { buildReadingChapters, layoutKnowledgeStructure } from '@/features/checkins/structure-reader-model';
import { knowledgeStructureSchema } from '@/lib/domain/knowledge-structure';
import { relationSummaryFixture } from '../../helpers/knowledge-structure-fixture';

const fixture = () => knowledgeStructureSchema.parse(relationSummaryFixture().structure);
describe('structure reader projection', () => {
  it('covers every real node once, including nodes missing from the suggested order', () => {
    const structure = fixture();
    const chapters = buildReadingChapters(structure);
    const names = chapters.flatMap(chapter => chapter.names);
    expect(names).toHaveLength(structure.nodes.length);
    expect(new Set(names)).toEqual(new Set(structure.nodes.map(node => node.name)));
    expect(chapters.find(chapter => chapter.names.includes('上下文'))?.names).toEqual(['上下文', '消息历史']);
    expect(chapters.find(chapter => chapter.names.includes('KV Cache'))).not.toEqual(chapters.find(chapter => chapter.names.includes('上下文压缩')));
  });
  it('handles unrelated topics and an empty reading order without synthesizing relationships', () => {
    const structure = { ...fixture(), readingOrder: [], relations: [] };
    const layout = layoutKnowledgeStructure(structure);
    expect(layout.nodes.map(node => node.name).sort()).toEqual(structure.nodes.map(node => node.name).sort());
    expect(layout.edges).toEqual([]);
    expect(buildReadingChapters(structure).flatMap(chapter => chapter.names)).toHaveLength(4);
  });
  it('keeps all directed and symmetric relationships, including feedback and multiple parents', () => {
    const structure = fixture();
    structure.relations.push(
      { from: 'KV Cache', to: '消息历史', kind: '分类', label: '分类示例', condition: '', evidence: '测试关系依据' },
      { from: '消息历史', to: '上下文压缩', kind: '反馈', label: '触发精简', condition: '', evidence: '测试关系依据' },
    );
    const layout = layoutKnowledgeStructure(structure);
    expect(layout.edges).toHaveLength(structure.relations.length);
    expect(layout.edges.map(edge => edge.index)).toEqual(structure.relations.map((_, index) => index));
    expect(layout.nodes).toHaveLength(4);
    expect(layout.edges.every(edge => !/NaN|Infinity/.test(edge.path))).toBe(true);
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y + node.height).toBeLessThanOrEqual(layout.height);
      expect(node.x + node.width).toBeLessThanOrEqual(layout.width);
    }
    expect(layoutKnowledgeStructure(structure)).toEqual(layout);
  });
  it('uses generic chapter labels for arguments, evidence, and constraints', () => {
    const structure = fixture();
    structure.nodes[0].role = '观点'; structure.nodes[1].role = '证据';
    structure.nodes[2].role = '约束'; structure.nodes[3].role = '条件';
    structure.relations = [];
    const chapters = buildReadingChapters(structure);
    expect(chapters.map(chapter => chapter.title)).toEqual(['观点与依据', '问题与边界']);
    expect(chapters[0].names).toEqual(['上下文', '消息历史']);
  });
  it('separates simultaneous action labels from the same mechanism', () => {
    const structure = fixture();
    structure.nodes.push({ ...structure.nodes[1], name: '工具定义' });
    structure.relations.push(
      { from: '上下文', to: '工具定义', kind: '包含', label: '包含工具', condition: '', evidence: '测试关系依据' },
      { from: 'KV Cache', to: '消息历史', kind: '作用', label: '复用历史前缀', condition: '', evidence: '测试关系依据' },
      { from: 'KV Cache', to: '工具定义', kind: '作用', label: '复用工具前缀', condition: '', evidence: '测试关系依据' },
    );
    const layout = layoutKnowledgeStructure(structure);
    const labels = layout.edges.filter(edge => structure.relations[edge.index].from === 'KV Cache');
    expect(labels).toHaveLength(2);
    expect(Math.abs(labels[0].labelY - labels[1].labelY)).toBeGreaterThanOrEqual(21);
  });
});
