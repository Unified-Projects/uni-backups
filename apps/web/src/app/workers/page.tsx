"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@uni-backups/ui/components/card";
import { Badge } from "@uni-backups/ui/components/badge";
import { Skeleton } from "@uni-backups/ui/components/skeleton";
import { Activity, CheckCircle, XCircle, Clock, Users } from "lucide-react";
import { API_URL } from "@/lib/api";

interface Worker {
  id: string;
  name: string;
  hostname: string;
  groups: string[];
  status: string;
  isHealthy: boolean;
  lastHeartbeat: number;
  currentJobs: string[];
  metrics?: {
    jobsProcessed: number;
    jobsFailed: number;
  };
}

interface WorkerGroup {
  groupId: string;
  workers: string[];
  primaryWorkerId: string | null;
  quorumSize: number;
  activeWorkers: string[];
  totalWorkers: number;
}

async function getWorkers(): Promise<{ workers: Worker[] }> {
  const res = await fetch(`${API_URL}/api/workers`);
  if (!res.ok) throw new Error("Failed to fetch workers");
  return res.json();
}

async function getWorkerGroups(): Promise<{ groups: WorkerGroup[] }> {
  const res = await fetch(`${API_URL}/api/workers/groups`);
  if (!res.ok) throw new Error("Failed to fetch worker groups");
  return res.json();
}

function WorkerStatusBadge({ status, isHealthy }: { status: string; isHealthy: boolean }) {
  if (isHealthy && status === "healthy") {
    return (
      <Badge variant="outline" className="health-indicator status-healthy bg-green-500/10 text-green-500 border-green-500/20">
        <CheckCircle className="mr-1 h-3 w-3" />
        Healthy
      </Badge>
    );
  }
  if (status === "degraded") {
    return (
      <Badge variant="outline" className="health-indicator status-degraded bg-yellow-500/10 text-yellow-500 border-yellow-500/20">
        <Activity className="mr-1 h-3 w-3" />
        Degraded
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="health-indicator status-offline bg-red-500/10 text-red-500 border-red-500/20">
      <XCircle className="mr-1 h-3 w-3" />
      Offline
    </Badge>
  );
}

export default function WorkersPage() {
  const { data: workersData, isLoading: workersLoading } = useQuery({
    queryKey: ["workers"],
    queryFn: getWorkers,
    refetchInterval: 10000,
  });

  const { data: groupsData, isLoading: groupsLoading } = useQuery({
    queryKey: ["worker-groups"],
    queryFn: getWorkerGroups,
    refetchInterval: 10000,
  });

  const workers = workersData?.workers || [];
  const groups = groupsData?.groups || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Workers</h1>
        <p className="text-muted-foreground">
          {workersLoading ? "Loading..." : `${workers.length} worker${workers.length !== 1 ? "s" : ""} registered`}
        </p>
      </div>

      {groups.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Worker Groups</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {groupsLoading ? (
              [1, 2].map((i) => (
                <Card key={i}>
                  <CardHeader><Skeleton className="h-5 w-32" /></CardHeader>
                  <CardContent><Skeleton className="h-16 w-full" /></CardContent>
                </Card>
              ))
            ) : (
              groups.map((group) => (
                <Card key={group.groupId} data-testid={`worker-group-${group.groupId}`} className="worker-group">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Users className="h-4 w-4" />
                      {group.groupId}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Primary</span>
                      <span className="font-mono text-xs">{group.primaryWorkerId || "None"}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Active / Total</span>
                      <span>{group.activeWorkers.length} / {group.totalWorkers}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Quorum</span>
                      <span>{group.quorumSize}</span>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">All Workers</h2>
        {workersLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader><Skeleton className="h-5 w-32" /></CardHeader>
                <CardContent><Skeleton className="h-20 w-full" /></CardContent>
              </Card>
            ))}
          </div>
        ) : workers.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">No workers registered</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {workers.map((worker) => (
              <Card
                key={worker.id}
                data-testid={`worker-item-${worker.id}`}
                className="worker-item worker-card"
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{worker.name}</CardTitle>
                    <WorkerStatusBadge status={worker.status} isHealthy={worker.isHealthy} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Hostname</span>
                    <span className="font-mono text-xs">{worker.hostname}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Groups</span>
                    <span>{worker.groups.join(", ") || "None"}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Last Heartbeat</span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {new Date(worker.lastHeartbeat).toLocaleTimeString()}
                    </span>
                  </div>
                  {worker.metrics && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Jobs (OK/Fail)</span>
                      <span className="text-green-600">{worker.metrics.jobsProcessed}</span>
                      <span className="text-red-500">{worker.metrics.jobsFailed}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
