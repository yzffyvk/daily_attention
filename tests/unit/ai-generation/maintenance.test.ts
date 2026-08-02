import { describe, expect, it, vi } from "vitest";
import { createMaintenanceHandler } from "@/supabase/functions/ai-generation-maintenance/index";

const token = "ai-maintenance-token-with-at-least-32-characters";

function request(authorization?: string) {
  return new Request("http://localhost/functions/v1/ai-generation-maintenance", {
    method: "POST",
    headers: authorization ? { Authorization: authorization } : {},
  });
}

describe("AI generation maintenance function", () => {
  it.each([undefined, "Bearer wrong-token"])(
    "rejects missing or invalid auth before cleanup",
    async (authorization) => {
      const expire = vi.fn();
      const handler = createMaintenanceHandler({ triggerToken: token, expire });

      const response = await handler(request(authorization));

      expect(response.status).toBe(401);
      expect(expire).not.toHaveBeenCalled();
    },
  );

  it("runs a bounded cleanup and returns counts only", async () => {
    const expire = vi.fn().mockResolvedValue({ clearedResults: 7, deletedJobs: 3 });
    const handler = createMaintenanceHandler({ triggerToken: token, expire });

    const response = await handler(request(`Bearer ${token}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(expire).toHaveBeenCalledExactlyOnceWith(500);
    expect(body).toEqual({
      requestId: expect.any(String),
      clearedResults: 7,
      deletedJobs: 3,
    });
  });

  it("keeps operational failures opaque", async () => {
    const handler = createMaintenanceHandler({
      triggerToken: token,
      expire: vi.fn().mockRejectedValue(new Error("raw generated text")),
    });

    const response = await handler(request(`Bearer ${token}`));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("generated text");
  });
});
