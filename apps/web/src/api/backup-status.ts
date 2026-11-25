import { type BackupStatus, BackupStatusResponse } from "@budget/schema/backup-status";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "./client";

export const getBackupStatus = async (): Promise<BackupStatus> =>
  (await apiFetch("/api/v1/backup-status", { schema: BackupStatusResponse })).data;

/** One cheap read; a failed read shows nothing (the warning is only a hint). */
export const useBackupStatus = () =>
  useQuery({
    queryKey: ["backup-status"],
    queryFn: getBackupStatus,
    staleTime: 5 * 60_000,
    retry: false,
  });
