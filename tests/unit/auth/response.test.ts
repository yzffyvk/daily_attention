import { describe, expect, it } from "vitest";
import { authFailure } from "@/server/auth/response";

describe("auth response mapping", () => {
  it("maps a duplicate login alias to the name field", async () => {
    const response = authFailure({ code: "23505" }, "request-id");

    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "NAME_TAKEN", details: { field: "name" } },
    });
  });
});
