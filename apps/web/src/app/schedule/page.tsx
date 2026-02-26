"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@uni-backups/ui/components/card";
import { Badge } from "@uni-backups/ui/components/badge";
import { Skeleton } from "@uni-backups/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@uni-backups/ui/components/table";
import {
  Clock,
  Activity,
  CheckCircle,
  XCircle,
  Calendar,
} from "lucide-react";
import { getSchedule } from "@/lib/api";
import { formatDistanceToNow, formatDuration } from "@/lib/utils";

function StatusBadge({ status }: { status: "pending" | "running" | "completed" | "success" | "failed" }) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500">
          <Clock className="mr-1 h-3 w-3" />
          Pending
        </Badge>
      );
    case "running":
      return (
        <Badge variant="outline" className="bg-blue-500/10 text-blue-500">
          <Activity className="mr-1 h-3 w-3 animate-pulse" />
          Running
        </Badge>
      );
    case "completed":
    case "success":
      return (
        <Badge variant="outline" className="bg-green-500/10 text-green-500">
          <CheckCircle className="mr-1 h-3 w-3" />
          Success
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="outline" className="bg-red-500/10 text-red-500">
          <XCircle className="mr-1 h-3 w-3" />
          Failed
        </Badge>
      );
  }
}

export default function SchedulePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["schedule"],
    queryFn: getSchedule,
    refetchInterval: 15000,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Schedule</h1>
          <p className="text-muted-foreground">Scheduled jobs and run history</p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-48 w-full" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-48 w-full" />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const scheduled = data?.scheduled || [];
  const running = data?.running || [];
  const recentRuns = data?.recent || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Schedule</h1>
        <p className="text-muted-foreground">Scheduled jobs and run history</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Scheduled Jobs
            </CardTitle>
            <CardDescription>
              {scheduled.length} job{scheduled.length !== 1 ? "s" : ""} scheduled
            </CardDescription>
          </CardHeader>
          <CardContent>
            {scheduled.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No jobs with schedules configured
              </p>
            ) : (
              <div className="space-y-3">
                {scheduled.map((job) => (
                  <div
                    key={job.name}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <p className="font-medium">{job.name}</p>
                      <p className="text-sm text-muted-foreground font-mono">
                        {job.schedule}
                      </p>
                    </div>
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Currently Running
            </CardTitle>
            <CardDescription>
              {running.length} job{running.length !== 1 ? "s" : ""} running
            </CardDescription>
          </CardHeader>
          <CardContent>
            {running.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No jobs currently running
              </p>
            ) : (
              <div className="space-y-3">
                {running.map((job) => (
                  <div
                    key={job.name}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div>
                      <p className="font-medium">{job.name}</p>
                      <p className="text-sm text-muted-foreground">
                        Started {formatDistanceToNow(new Date(job.startTime))}
                      </p>
                    </div>
                    <Badge variant="outline" className="bg-blue-500/10 text-blue-500">
                      <Activity className="mr-1 h-3 w-3 animate-pulse" />
                      Running
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Runs</CardTitle>
          <CardDescription>Last 20 backup job executions</CardDescription>
        </CardHeader>
        <CardContent>
          {recentRuns.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No backup runs recorded yet
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentRuns.map((run, index) => (
                  <TableRow key={`${run.jobName}-${run.startTime}-${index}`}>
                    <TableCell className="font-medium">{run.jobName}</TableCell>
                    <TableCell>
                      {new Date(run.startTime).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {run.endTime
                        ? formatDuration(new Date(run.startTime), new Date(run.endTime))
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {run.message || "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
