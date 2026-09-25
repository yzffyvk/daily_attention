import { describe, expect, it } from 'vitest';
import { parseLearningReflections, serializeLearningReflections } from '@/lib/domain/learning-reflections';
describe('learning reflection document', () => {
  it('preserves ordinary legacy text exactly', () => {
    for (const text of ['', '  原文\n\n ', '## 新的理解\n旧笔记\\']) {
      expect(serializeLearningReflections(parseLearningReflections(text))).toBe(text);
    }
  });
  it('roundtrips independent fields, reserved lines and backslashes without mutation', () => {
    const value = { explanation: '解释\n## 新的理解\n\\尾\n<!-- learning-reflections:v1 -->\n<!-- /learning-reflections -->\n', insights: '新理解', ideas: '\n有趣\n' };
    const before = { ...value };
    expect(parseLearningReflections(serializeLearningReflections(value))).toEqual(value);
    expect(value).toEqual(before);
  });
  it('preserves malformed versioned text as legacy', () => {
    const value = '<!-- learning-reflections:v1 -->\n## 用自己的话解释\n不完整';
    expect(parseLearningReflections(value)).toEqual({ explanation: value, insights: '', ideas: '' });
  });
  it('can hold an entire formatted document literally in explanation', () => {
    const literal = serializeLearningReflections({ explanation: 'a', insights: 'b', ideas: 'c' });
    expect(parseLearningReflections(serializeLearningReflections({ explanation: literal, insights: '', ideas: '' }))).toEqual({ explanation: literal, insights: '', ideas: '' });
  });
});

it('serializes all-empty fields as ordinary empty text', () => { expect(serializeLearningReflections({ explanation: '', insights: '', ideas: '' })).toBe(''); });
