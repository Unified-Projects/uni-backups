export type {
  WorkerState,
  WorkerGroupState,
  JobExecution,
} from "@uni-backups/shared/redis";

import type { JobConfig, StorageConfig, Retention } from "@uni-backups/shared/config";

export type JobTrigger = "schedule" | "manual" | "failover";

export interface BackupJobData {
  executionId: string;
  jobName: string;
  jobConfig: JobConfig;
  storage: StorageConfig;
  repoName: string;
  workerGroups: string[];
  priority: number;
  triggeredBy: JobTrigger;
  originalWorkerId?: string;
  queuedAt: number;
}

export interface ScheduledJobData {
  jobName: string;
}

export interface PruneJobData {
  executionId: string;
  jobName: string;
  storage: StorageConfig;
  repoName: string;
  retention: Retention;
  tags?: string[];
  workerGroups: string[];
}

export interface HealthCheckData {
  groupId: string;
  initiatorWorkerId: string;
  timestamp: number;
}

export interface FailoverJobData {
  groupId: string;
  failedWorkerId: string;
  initiatorWorkerId: string;
  reason: string;
  timestamp: number;
}

export interface BackupResult {
  success: boolean;
  snapshotId?: string;
  message: string;
  bytesProcessed?: number;
  filesProcessed?: number;
  filesAdded?: number;
  filesChanged?: number;
  duration?: number;
}

export interface PruneResult {
  success: boolean;
  message: string;
  snapshotsRemoved?: number;
  spaceReclaimed?: number;
  duration: number;
}
