"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@uni-backups/ui/components/card";
import { Button } from "@uni-backups/ui/components/button";
import {
  Database,
  ChevronRight,
  Clock,
  HardDrive,
  Camera,
  AlertCircle,
} from "lucide-react";
import { formatBytes } from "@/lib/utils";
import type { StorageRepoStats } from "@/lib/api";

interface RepoCardProps {
  repo: StorageRepoStats;
  storageName: string;
  onSelect: (repo: string) => void;
}

export function RepoCard({ repo, storageName, onSelect }: RepoCardProps) {
  if (repo.error) {
    return (
      <Card className="border-yellow-500/50">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-yellow-500/10 p-2">
                <AlertCircle className="h-5 w-5 text-yellow-500" />
              </div>
              <div>
                <CardTitle className="text-lg">{repo.repo}</CardTitle>
                <CardDescription className="text-yellow-600">
                  {repo.error}
                </CardDescription>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onSelect(repo.repo)}
          >
            View Details
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="group hover:border-primary/50 transition-colors">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-muted p-2">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="text-lg">{repo.repo}</CardTitle>
              <CardDescription>
                Repository on {storageName}
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg bg-muted/50 p-3">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
              <Camera className="h-3 w-3" />
              Snapshots
            </div>
            <p className="text-lg font-semibold">{repo.snapshotsCount}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
              <HardDrive className="h-3 w-3" />
              Size
            </div>
            <p className="text-lg font-semibold">{formatBytes(repo.totalSize)}</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
              <Clock className="h-3 w-3" />
              Files
            </div>
            <p className="text-lg font-semibold">{repo.totalFileCount.toLocaleString()}</p>
          </div>
        </div>

        <Button
          className="w-full"
          onClick={() => onSelect(repo.repo)}
        >
          View Snapshots
          <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

interface RepoCardSkeletonProps {
  count?: number;
}

export function RepoCardSkeleton({ count = 1 }: RepoCardSkeletonProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted animate-pulse" />
              <div className="space-y-2">
                <div className="h-5 w-32 bg-muted animate-pulse rounded" />
                <div className="h-4 w-24 bg-muted animate-pulse rounded" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-20 bg-muted animate-pulse rounded" />
          </CardContent>
        </Card>
      ))}
    </>
  );
}
