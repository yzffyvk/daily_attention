import { z } from "zod";
import { dateKeySchema } from "./checkin.ts";

const text = (max: number) => z.string().trim().min(1).max(max);
const id = z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/);
const dates = z.array(dateKeySchema).max(14).refine(value => new Set(value).size === value.length);

export const conceptMapSchema = z.object({
  schemaVersion: z.literal(2), mode: z.literal("concept_map"),
  title: text(120), overview: text(1500), focusQuestion: text(300),
  organization: z.enum(["hierarchy", "process", "comparison"]),
  branches: z.array(z.object({ id, title: text(40), summary: text(300) }).strict()).min(1).max(6),
  concepts: z.array(z.object({
    id, branchId: id, label: text(40), explanation: text(1000),
    kind: z.enum(["concept", "principle", "method", "example", "condition"]),
    origin: z.enum(["record", "ai_supplement"]), sourceDates: dates,
    supplementReason: z.string().trim().max(300),
  }).strict()).min(2).max(30),
  connections: z.array(z.object({
    fromId: id, toId: id, relation: text(40), explanation: text(500),
    origin: z.enum(["record", "inference", "ai_supplement"]), sourceDates: dates,
  }).strict()).min(1).max(45),
  outline: z.array(z.object({ title: text(100), body: text(1500), conceptIds: z.array(id).min(1).max(30) }).strict()).min(1).max(6),
  gaps: z.array(text(500)).max(6),
}).strict();

export const sourceRecordsSchema = z.object({
  schemaVersion: z.literal(2), mode: z.literal("source_records"), title: text(120),
  reason: z.enum(["mixed_topics", "insufficient_material"]), sourceDates: dates.min(2),
}).strict();

const recordIds = z.array(z.uuid()).max(14).refine(value => new Set(value).size === value.length);
export const recordConceptMapSchema = conceptMapSchema.extend({
  schemaVersion: z.literal(3),
  concepts: z.array(conceptMapSchema.shape.concepts.element.omit({ sourceDates: true }).extend({ sourceRecordIds: recordIds })).min(2).max(30),
  connections: z.array(conceptMapSchema.shape.connections.element.omit({ sourceDates: true }).extend({ sourceRecordIds: recordIds })).min(1).max(45),
});
export const recordSourceRecordsSchema = sourceRecordsSchema.omit({ sourceDates: true }).extend({
  schemaVersion: z.literal(3), sourceRecordIds: recordIds.min(2),
});
export const knowledgeMapResultSchema = z.union([
  z.discriminatedUnion("mode", [conceptMapSchema, sourceRecordsSchema]),
  z.discriminatedUnion("mode", [recordConceptMapSchema, recordSourceRecordsSchema]),
]);
export function sourceReferences(value: { sourceDates?: string[]; sourceRecordIds?: string[] }): string[] {
  return value.sourceRecordIds ?? value.sourceDates ?? [];
}
export type AnyConceptMapResult = z.infer<typeof conceptMapSchema> | z.infer<typeof recordConceptMapSchema>;
export type ConceptMapResult = z.infer<typeof conceptMapSchema>;
export type SourceRecordsResult = z.infer<typeof sourceRecordsSchema>;
export type KnowledgeMapResult = z.infer<typeof knowledgeMapResultSchema>;
export type KnowledgeConcept = AnyConceptMapResult["concepts"][number];

/** Structural provenance checks; semantic accuracy still depends on the cited material. */
export function validateKnowledgeMapResult(result: KnowledgeMapResult, sourceDates: string[]): KnowledgeMapResult {
  const knownDates = new Set(sourceDates);
  const checkDates = (references: string[]) => {
    if (references.some(date => !knownDates.has(date))) throw new Error("NARRATIVE_SOURCE_REFERENCE_INVALID");
  };
  const checkCoverage = (references: string[]) => {
    checkDates(references);
    if (new Set(references).size !== knownDates.size) throw new Error("NARRATIVE_SOURCE_COVERAGE_INVALID");
  };
  if (result.mode === "source_records") {
    checkCoverage(sourceReferences(result));
    return result.schemaVersion === 3 ? { ...result, sourceRecordIds: [...result.sourceRecordIds].sort() } : { ...result, sourceDates: [...result.sourceDates].sort() };
  }

  const branches = new Set(result.branches.map(branch => branch.id));
  const concepts = new Map(result.concepts.map(concept => [concept.id, concept]));
  if (branches.size !== result.branches.length || concepts.size !== result.concepts.length) throw new Error("NARRATIVE_MAP_ID_INVALID");
  const supplements = result.concepts.filter(concept => concept.origin === "ai_supplement");
  if (supplements.length > 3) throw new Error("NARRATIVE_SUPPLEMENT_LIMIT");
  for (const concept of result.concepts) {
    if (!branches.has(concept.branchId)) throw new Error("NARRATIVE_BRANCH_INVALID");
    checkDates(sourceReferences(concept));
    if (concept.origin === "record" ? !sourceReferences(concept).length || Boolean(concept.supplementReason) : sourceReferences(concept).length > 0 || !concept.supplementReason) {
      throw new Error("NARRATIVE_CONCEPT_PROVENANCE_INVALID");
    }
  }
  checkCoverage(result.concepts.flatMap(concept => sourceReferences(concept)));
  for (const branch of branches) {
    if (!result.concepts.some(concept => concept.branchId === branch && concept.origin === "record")) throw new Error("NARRATIVE_BRANCH_INVALID");
  }
  const edges = new Set<string>();
  for (const edge of result.connections) {
    const from = concepts.get(edge.fromId), to = concepts.get(edge.toId);
    const key = `${edge.fromId}:${edge.toId}`;
    if (!from || !to || from === to || edges.has(key)) throw new Error("NARRATIVE_CONNECTION_INVALID");
    edges.add(key);
    checkDates(sourceReferences(edge));
    const includesSupplement = from.origin === "ai_supplement" || to.origin === "ai_supplement";
    if (edge.origin === "ai_supplement" ? sourceReferences(edge).length > 0 : includesSupplement || !sourceReferences(edge).length) {
      throw new Error("NARRATIVE_CONNECTION_PROVENANCE_INVALID");
    }
  }
  for (const supplement of supplements) {
    const grounded = result.connections.some(edge =>
      edge.fromId === supplement.id && concepts.get(edge.toId)?.origin === "record" ||
      edge.toId === supplement.id && concepts.get(edge.fromId)?.origin === "record");
    if (!grounded) throw new Error("NARRATIVE_SUPPLEMENT_UNCONNECTED");
  }
  const outlineBranches = new Set<string>();
  for (const step of result.outline) {
    if (new Set(step.conceptIds).size !== step.conceptIds.length) throw new Error("NARRATIVE_OUTLINE_INVALID");
    for (const conceptId of step.conceptIds) {
      const concept = concepts.get(conceptId);
      if (!concept) throw new Error("NARRATIVE_OUTLINE_INVALID");
      outlineBranches.add(concept.branchId);
    }
  }
  if (outlineBranches.size !== branches.size) throw new Error("NARRATIVE_OUTLINE_INVALID");
  return result;
}
