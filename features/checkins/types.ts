export type CheckInRecord = {
  id: string;
  date: string;
  attention: string;
  sourceUrl: string;
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
  "date" | "attention" | "version" | "updatedAt"
> & { hasImage: boolean };

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
