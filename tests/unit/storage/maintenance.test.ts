import { describe, expect, it, vi } from "vitest";
import {
  runStorageMaintenance,
  type StorageMaintenancePort,
} from "@/server/storage/maintenance";

function port(
  overrides: Partial<StorageMaintenancePort> = {},
): StorageMaintenancePort {
  return {
    deleteExpiredReservations: vi.fn().mockResolvedValue(0),
    listOrphanPaths: vi.fn().mockResolvedValue([]),
    removeObjects: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("runStorageMaintenance", () => {
  it("deletes expired reservations before orphan objects", async () => {
    const maintenancePort = port({
      deleteExpiredReservations: vi.fn().mockResolvedValue(3),
      listOrphanPaths: vi.fn().mockResolvedValue(["a", "b"]),
    });

    await expect(
      runStorageMaintenance(maintenancePort, 100),
    ).resolves.toEqual({
      deletedReservations: 3,
      deletedOrphans: 2,
    });
    expect(
      vi.mocked(maintenancePort.deleteExpiredReservations),
    ).toHaveBeenCalledExactlyOnceWith(100);
    expect(
      vi.mocked(maintenancePort.listOrphanPaths),
    ).toHaveBeenCalledExactlyOnceWith(100);
    expect(maintenancePort.removeObjects).toHaveBeenCalledExactlyOnceWith([
      "a",
      "b",
    ]);
    expect(
      vi.mocked(maintenancePort.deleteExpiredReservations).mock
        .invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(maintenancePort.listOrphanPaths).mock.invocationCallOrder[0],
    );
    expect(
      vi.mocked(maintenancePort.listOrphanPaths).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(maintenancePort.removeObjects).mock.invocationCallOrder[0],
    );
  });

  it("uses a default limit of 100 and skips an empty Storage removal", async () => {
    const maintenancePort = port();

    await expect(runStorageMaintenance(maintenancePort)).resolves.toEqual({
      deletedReservations: 0,
      deletedOrphans: 0,
    });
    expect(
      maintenancePort.deleteExpiredReservations,
    ).toHaveBeenCalledExactlyOnceWith(100);
    expect(maintenancePort.listOrphanPaths).toHaveBeenCalledExactlyOnceWith(100);
    expect(maintenancePort.removeObjects).not.toHaveBeenCalled();
  });

  it.each([
    ["reservation cleanup", "deleteExpiredReservations"],
    ["orphan listing", "listOrphanPaths"],
    ["object removal", "removeObjects"],
  ] as const)("propagates a %s failure for platform retry", async (_label, method) => {
    const failure = new Error("maintenance unavailable");
    const maintenancePort = port({
      listOrphanPaths: vi.fn().mockResolvedValue(["a"]),
      [method]: vi.fn().mockRejectedValue(failure),
    });

    await expect(runStorageMaintenance(maintenancePort)).rejects.toBe(failure);
  });

  it.each([0, 501, 1.5, Number.NaN])(
    "rejects invalid limit %s before calling a port",
    async (limit) => {
      const maintenancePort = port();

      await expect(
        runStorageMaintenance(maintenancePort, limit),
      ).rejects.toThrow("Invalid storage maintenance limit");
      expect(maintenancePort.deleteExpiredReservations).not.toHaveBeenCalled();
      expect(maintenancePort.listOrphanPaths).not.toHaveBeenCalled();
      expect(maintenancePort.removeObjects).not.toHaveBeenCalled();
    },
  );
});
