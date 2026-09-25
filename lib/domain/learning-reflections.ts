export type ReflectionKey = 'explanation' | 'insights' | 'ideas';
export type LearningReflections = Record<ReflectionKey, string>;
export const LEARNING_REFLECTIONS_LIMIT = 2000;
const marker = '<!-- learning-reflections:v1 -->';
const keys: ReflectionKey[] = ['explanation', 'insights', 'ideas'];
const headings = ['## 用自己的话解释', '## 新的理解', '## 有趣的思想点'];
const endMarker = '<!-- /learning-reflections -->';
function escapeText(text: string) {
  return text.split('\n').map(line => /^(\\|## |<!--)/.test(line) ? `\\${line}` : line).join('\n');
}
function format(value: LearningReflections) {
  return [marker, ...keys.flatMap((key, index) => [headings[index], escapeText(value[key])]), endMarker].join('\n');
}
function parseFormatted(value: string): LearningReflections | null {
  const lines = value.split('\n');
  if (lines[0] !== marker || lines.at(-1) !== endMarker) return null;
  const result: LearningReflections = { explanation: '', insights: '', ideas: '' };
  let cursor = 1;
  for (let index = 0; index < keys.length; index++) {
    if (lines[cursor++] !== headings[index]) return null;
    const content: string[] = [];
    const next = headings[index + 1] ?? endMarker;
    while (cursor < lines.length && lines[cursor] !== next) content.push(lines[cursor++]);
    if (!content.length || cursor >= lines.length) return null;
    result[keys[index]] = content.map(line => line.startsWith('\\') ? line.slice(1) : line).join('\n');
  }
  return cursor === lines.length - 1 && format(result) === value ? result : null;
}
/** Only the exact canonical versioned document is treated as structured data. */
export function parseLearningReflections(value: string): LearningReflections {
  return parseFormatted(value) ?? { explanation: value, insights: '', ideas: '' };
}
/** Does not truncate: callers validate the length of the serialized storage value. */
export function serializeLearningReflections(value: LearningReflections): string {
  if (!value.insights && !value.ideas && !parseFormatted(value.explanation)) return value.explanation;
  return format(value);
}
