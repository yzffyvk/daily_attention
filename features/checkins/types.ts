import type { CheckInEntryMode } from "@/lib/domain/checkin";
import type { AiGenerationContext } from "@/lib/domain/ai-prompt";

export type CheckInRecord = {
  id: string;
  date: string;
  entryMode?: CheckInEntryMode;
  attention: string;
  sourceUrl: string;
  userPrompt?: string;
  aiGenerationContext?: AiGenerationContext | null;
  summary: string;
  inspiration: string;
  imagePath: string | null;
  imageName: string;
  imageUrl: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CheckInSummary = Pick<
  CheckInRecord,
  "date" | "entryMode" | "attention" | "version" | "updatedAt"
> & { hasImage: boolean; id?: string; status?: "pending" | "completed"; albumId?: string | null; createdAt?: string };

export type CheckInStats = {
  totalCount: number;
  currentStreak: number;
  hasTodayRecord: boolean;
};

export type VersionConflict = {
  ok: false;
  reason: "VERSION_CONFLICT";
  current: CheckInRecord | null;
};
