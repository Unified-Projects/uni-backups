"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@uni-backups/ui/components/card";
import { Badge } from "@uni-backups/ui/components/badge";
import { Button } from "@uni-backups/ui/components/button";
import { Skeleton } from "@uni-backups/ui/components/skeleton";
import {
  CheckCircle,
  XCircle,
  Clock,
  HardDrive,
  FolderArchive,
  Activity,
  Play,
} from "lucide-react";
import Link from "next/link";
import { getJobs, getStorage, runJob, type Job, type Storage } from "@/lib/api";
import { formatDistanceToNow } from "@/lib/utils";

function JobStatusBadge({ job }: { job: Job }) {
  if (job.isRunning) {
    return (
      <Badge variant="outline" className="bg-blue-500/10 text-blue-500 border-blue-500/20">
        <Activity className="mr-1 h-3 w-3 animate-pulse" />
        Running
      </Badge>
    );
  }

  if (!job.lastRun) {
    return (
      <Badge variant="outline" className="bg-muted text-muted-foreground">
        <Clock className="mr-1 h-3 w-3" />
        Never run
      </Badge>
    );
  }

  if (job.lastRun.status === "success") {
    return (
      <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20">
        <CheckCircle className="mr-1 h-3 w-3" />
        Success
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">
      <XCircle className="mr-1 h-3 w-3" />
      Failed
    </Badge>
  );
}

function DashboardStats({
  jobs,
  storage,
}: {
  jobs: Job[];
  storage: Storage[];
}) {
  const runningCount = jobs.filter((j) => j.isRunning).length;
  const successCount = jobs.filter((j) => j.lastRun?.status === "success").length;
  const _failedCount = jobs.filter((j) => j.lastRun?.status === "failed").length;

  const stats = [
    {
      name: "Total Jobs",
      value: jobs.length,
      icon: FolderArchive,
      color: "text-primary",
      testId: "job-summary",
    },
    {
      name: "Storage Backends",
      value: storage.length,
      icon: HardDrive,
      color: "text-blue-500",
      testId: "storage-summary",
    },
    {
      name: "Running",
      value: runningCount,
      icon: Activity,
      color: "text-yellow-500",
      testId: "worker-summary",
    },
    {
      name: "Healthy",
      value: successCount,
      icon: CheckCircle,
      color: "text-green-500",
      testId: "health-status",
    },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.name} data-testid={stat.testId} className="transition-all duration-200 hover:shadow-md hover:border-primary/20">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{stat.name}</CardTitle>
            <div className={`rounded-full p-2 bg-muted ${stat.color}`}>
              <stat.icon className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stat.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function RecentActivity({ jobs }: { jobs: Job[] }) {
  const sortedJobs = [...jobs]
    .filter((j) => j.lastRun)
    .sort((a, b) => {
      const aTime = a.lastRun?.endTime || a.lastRun?.startTime || "";
      const bTime = b.lastRun?.endTime || b.lastRun?.startTime || "";
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    })
    .slice(0, 5);

  if (sortedJobs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
          <CardDescription>No backup runs yet</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Run a backup job to see activity here.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>Latest backup runs</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {sortedJobs.map((job) => (
            <div
              key={job.name}
              className="flex items-center justify-between border-b pb-4 last:border-0 last:pb-0"
            >
              <div className="space-y-1">
                <Link
                  href={`/jobs?name=${job.name}`}
                  className="font-medium hover:underline"
                >
                  {job.name}
                </Link>
                <p className="text-sm text-muted-foreground">
                  {job.lastRun?.endTime
                    ? formatDistanceToNow(new Date(job.lastRun.endTime))
                    : "Running..."}
                </p>
              </div>
              <JobStatusBadge job={job} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function JobsList({ jobs }: { jobs: Job[] }) {
  const queryClient = useQueryClient();
  const runMutation = useMutation({
    mutationFn: (jobName: string) => runJob(jobName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Backup Jobs</CardTitle>
        <CardDescription>All configured backup jobs</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {jobs.map((job) => (
            <div
              key={job.name}
              className="flex items-center justify-between rounded-lg border p-3 transition-all duration-200 hover:bg-muted/50 hover:shadow-sm hover:border-primary/20"
            >
              <Link
                href={`/jobs?name=${job.name}`}
                className="flex items-center gap-3 flex-1 min-w-0"
              >
                <div
                  className={`rounded-full p-2 flex-shrink-0 ${
                    job.type === "postgres" || job.type === "mariadb" || job.type === "redis"
                      ? "bg-purple-500/10"
                      : "bg-blue-500/10"
                  }`}
                >
                  <FolderArchive
                    className={`h-4 w-4 ${
                      job.type === "postgres" || job.type === "mariadb" || job.type === "redis"
                        ? "text-purple-500"
                        : "text-blue-500"
                    }`}
                  />
                </div>
                <div className="min-w-0">
                  <p className="font-medium truncate">{job.name}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {job.type} - {job.storage}
                  </p>
                </div>
              </Link>
              <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                {job.schedule && (
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    <Clock className="mr-1 inline h-3 w-3" />
                    {job.schedule}
                  </span>
                )}
                <JobStatusBadge job={job} />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={job.isRunning || runMutation.isPending}
                  onClick={(e) => {
                    e.preventDefault();
                    runMutation.mutate(job.name);
                  }}
                >
                  <Play className="h-3 w-3 mr-1" />
                  Run
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { data: jobsData, isLoading: jobsLoading } = useQuery({
    queryKey: ["jobs", "all"],
    queryFn: () => getJobs({ pageSize: 1000 }), // Get all jobs for dashboard stats
    refetchInterval: 15000,
  });

  const { data: storageData, isLoading: storageLoading } = useQuery({
    queryKey: ["storage"],
    queryFn: getStorage,
  });

  const isLoading = jobsLoading || storageLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Overview of your backup system</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-12" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const jobs = jobsData?.jobs || [];
  const storage = storageData?.storage || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your backup system</p>
      </div>

      <DashboardStats jobs={jobs} storage={storage} />

      <div className="grid gap-6 lg:grid-cols-2">
        <RecentActivity jobs={jobs} />
        <JobsList jobs={jobs} />
      </div>
    </div>
  );
}
