import { describe, expect, it } from "vitest";
import { validateNarrativeResult } from "@/lib/domain/knowledge-narrative";
import { knowledgeMapFixture, mapDates, sourceRecordsFixture } from "@/tests/helpers/knowledge-map-fixtures";

describe("concept knowledge map contracts", () => {
  it("accepts concepts independent of dates and a clearly separated AI bridge", () => {
    expect(validateNarrativeResult(knowledgeMapFixture(), mapDates)).toMatchObject({
      schemaVersion: 2, mode: "concept_map", concepts: expect.arrayContaining([expect.objectContaining({ id: "hypothesis", origin: "ai_supplement", sourceDates: [] })]),
    });
  });
  it("accepts one concept supported by multiple selected days", () => {
    const result = knowledgeMapFixture();
    result.concepts[0].sourceDates.push(mapDates[2]);
    expect(() => validateNarrativeResult(result, mapDates)).not.toThrow();
  });
  it("accepts mixed topics without invented connections or model-written records", () => {
    expect(validateNarrativeResult(sourceRecordsFixture(), mapDates)).toEqual(sourceRecordsFixture());
  });
  it("rejects silently dropped dates in maps and source-only results", () => {
    const map = knowledgeMapFixture(); map.concepts[2].sourceDates = [mapDates[0]];
    const records = sourceRecordsFixture(); records.sourceDates.pop();
    expect(() => validateNarrativeResult(map, mapDates)).toThrow();
    expect(() => validateNarrativeResult(records, mapDates)).toThrow();
  });
  it("rejects fabricated source dates on concepts and inferred relationships", () => {
    const concept = knowledgeMapFixture(); concept.concepts[0].sourceDates = ["2026-09-12"];
    const edge = knowledgeMapFixture(); edge.connections[0].sourceDates = ["2026-09-12"];
    expect(() => validateNarrativeResult(concept, mapDates)).toThrow();
    expect(() => validateNarrativeResult(edge, mapDates)).toThrow();
  });
  it("rejects supplements presented as dated learning or lacking a reason", () => {
    const dated = knowledgeMapFixture(); dated.concepts[3].sourceDates = [mapDates[0]];
    const unexplained = knowledgeMapFixture(); unexplained.concepts[3].supplementReason = "";
    expect(() => validateNarrativeResult(dated, mapDates)).toThrow();
    expect(() => validateNarrativeResult(unexplained, mapDates)).toThrow();
  });
  it("rejects unrelated or excessive AI supplements", () => {
    const isolated = knowledgeMapFixture(); isolated.connections = isolated.connections.slice(0, 1);
    const excessive = knowledgeMapFixture();
    for (let i = 0; i < 3; i++) {
      excessive.concepts.push({ ...excessive.concepts[3], id: `extra-${i}` });
      excessive.connections.push({ ...excessive.connections[1], toId: `extra-${i}` });
    }
    expect(() => validateNarrativeResult(isolated, mapDates)).toThrow();
    expect(() => validateNarrativeResult(excessive, mapDates)).toThrow();
  });
  it("rejects duplicated or dangling concept and branch references", () => {
    const duplicate = knowledgeMapFixture(); duplicate.concepts[1].id = "interview";
    const dangling = knowledgeMapFixture(); dangling.connections[0].toId = "missing";
    const branch = knowledgeMapFixture(); branch.concepts[0].branchId = "missing";
    for (const result of [duplicate, dangling, branch]) expect(() => validateNarrativeResult(result, mapDates)).toThrow();
  });
  it("rejects self links and duplicate links", () => {
    const self = knowledgeMapFixture(); self.connections[0].toId = "interview";
    const duplicate = knowledgeMapFixture(); duplicate.connections.push(duplicate.connections[0]);
    expect(() => validateNarrativeResult(self, mapDates)).toThrow();
    expect(() => validateNarrativeResult(duplicate, mapDates)).toThrow();
  });
  it("rejects AI bridges disguised as source-supported relations", () => {
    const result = knowledgeMapFixture(); result.connections[1] = { ...result.connections[0], toId: "hypothesis" };
    expect(() => validateNarrativeResult(result, mapDates)).toThrow();
  });
  it("keeps the speaking outline grounded in the same concepts", () => {
    const result = knowledgeMapFixture(); result.outline[0].conceptIds = ["new-unlearned-topic"];
    expect(() => validateNarrativeResult(result, mapDates)).toThrow();
  });
  it("rejects supplemented or rewritten content in the records-only branch", () => {
    expect(() => validateNarrativeResult({ ...sourceRecordsFixture(), concepts: knowledgeMapFixture().concepts }, mapDates)).toThrow();
    expect(() => validateNarrativeResult({ ...sourceRecordsFixture(), summary: "模型改写的记录" }, mapDates)).toThrow();
  });
});
