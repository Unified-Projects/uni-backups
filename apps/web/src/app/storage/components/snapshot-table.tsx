"use client";

import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@uni-backups/ui/components/table";
import { Button } from "@uni-backups/ui/components/button";
import { Badge } from "@uni-backups/ui/components/badge";
import { Skeleton } from "@uni-backups/ui/components/skeleton";
import { FolderOpen, RotateCcw, Clock, Server as ServerIcon } from "lucide-react";
import type { Snapshot } from "@/lib/api";

interface SnapshotTableProps {
  snapshots: Snapshot[];
  storage: string;
  repo: string;
  isLoading?: boolean;
}

export function SnapshotTable({
  snapshots,
  storage,
  repo,
  isLoading,
}: SnapshotTableProps) {
  if (isLoading) {
    return <SnapshotTableSkeleton />;
  }

  if (snapshots.length === 0) {
    return (
      <div className="rounded-lg border p-8 text-center">
        <Clock className="mx-auto h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-medium">No snapshots yet</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          This repository has no backup snapshots.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Hostname</TableHead>
            <TableHead>Paths</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {snapshots.map((snapshot) => (
            <TableRow key={snapshot.id}>
              <TableCell className="font-mono text-sm">
                {snapshot.short_id}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div>{new Date(snapshot.time).toLocaleDateString()}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(snapshot.time).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <ServerIcon className="h-4 w-4 text-muted-foreground" />
                  {snapshot.hostname}
                </div>
              </TableCell>
              <TableCell>
                <div className="max-w-48 truncate text-sm text-muted-foreground" title={snapshot.paths.join(", ")}>
                  {snapshot.paths.length === 1
                    ? snapshot.paths[0]
                    : `${snapshot.paths.length} paths`}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {snapshot.tags && snapshot.tags.length > 0 ? (
                    snapshot.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-xs">
                        {tag}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <Link
                    href={`/snapshots?storage=${storage}&repo=${repo}&id=${snapshot.short_id}`}
                  >
                    <Button variant="outline" size="sm">
                      <FolderOpen className="mr-1 h-3 w-3" />
                      Browse
                    </Button>
                  </Link>
                  <Link
                    href={`/restore?storage=${storage}&repo=${repo}&snapshot=${snapshot.short_id}`}
                  >
                    <Button variant="outline" size="sm">
                      <RotateCcw className="mr-1 h-3 w-3" />
                      Restore
                    </Button>
                  </Link>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SnapshotTableSkeleton() {
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ID</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Hostname</TableHead>
            <TableHead>Paths</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {[1, 2, 3, 4, 5].map((i) => (
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-4 w-16" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-8 w-24" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-20" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-32" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-16" />
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-2">
                  <Skeleton className="h-8 w-20" />
                  <Skeleton className="h-8 w-20" />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
