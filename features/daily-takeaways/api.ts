import { requestApi } from "@/features/checkins/api";
import { takeawayStateSchema, type TakeawayAction } from "@/lib/domain/daily-takeaway";

export async function getTakeawayState(signal?: AbortSignal) {
  return takeawayStateSchema.parse(await requestApi("/api/daily-takeaways", { signal }));
}

export async function applyTakeawayAction(input: TakeawayAction) {
  return takeawayStateSchema.parse(await requestApi("/api/daily-takeaways", { method: "POST", body: JSON.stringify(input) }));
}
