import type { CheckInEntryMode } from "@/lib/domain/checkin";
import { requestApi } from "@/features/checkins/api";
import type { KnowledgeNarrative, NarrativeResult, NarrativeSummary } from "@/lib/domain/knowledge-narrative";

export type CreateNarrativeInput = { entryMode?: CheckInEntryMode; dates: string[]; recordIds?: never; question: string; idempotencyKey: string } | { recordIds:string[]; dates?:never; entryMode?:never; question:string; idempotencyKey:string };
export const getNarratives = () => requestApi<NarrativeSummary[]>("/api/knowledge-narratives");
export const getNarrative = (id: string) => requestApi<KnowledgeNarrative>(`/api/knowledge-narratives/${encodeURIComponent(id)}`);
export const createNarrative = (input: CreateNarrativeInput) => requestApi<KnowledgeNarrative>("/api/knowledge-narratives", { method: "POST", body: JSON.stringify(input) });
export const renameNarrative = ({ id, title }: { id: string; title: string }) => requestApi<KnowledgeNarrative>(`/api/knowledge-narratives/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ title }) });
export const updateNarrative = ({ id, result, expectedUpdatedAt }: { id: string; result: NarrativeResult; expectedUpdatedAt: string }) => requestApi<KnowledgeNarrative>(`/api/knowledge-narratives/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ result, expectedUpdatedAt }) });
export const copyNarrative = ({ id, idempotencyKey }: { id: string; idempotencyKey: string }) => requestApi<KnowledgeNarrative>(`/api/knowledge-narratives/${encodeURIComponent(id)}/copy`, { method: "POST", body: JSON.stringify({ idempotencyKey }) });
export const deleteNarrative = (id: string) => requestApi<{ id: string }>(`/api/knowledge-narratives/${encodeURIComponent(id)}`, { method: "DELETE" });
