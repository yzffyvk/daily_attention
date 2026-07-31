import "server-only";

export type StorageMaintenancePort = {
  deleteExpiredReservations(limit: number): Promise<number>;
  listOrphanPaths(limit: number): Promise<string[]>;
  removeObjects(paths: string[]): Promise<void>;
};

export async function runStorageMaintenance(
  port: StorageMaintenancePort,
  limit = 100,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Invalid storage maintenance limit");
  }

  const deletedReservations = await port.deleteExpiredReservations(limit);
  const orphanPaths = await port.listOrphanPaths(limit);
  if (orphanPaths.length > 0) {
    await port.removeObjects(orphanPaths);
  }

  return {
    deletedReservations,
    deletedOrphans: orphanPaths.length,
  };
}
