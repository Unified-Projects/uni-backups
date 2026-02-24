"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@uni-backups/ui/components/card";
import { Button } from "@uni-backups/ui/components/button";
import { Skeleton } from "@uni-backups/ui/components/skeleton";
import {
  Server,
  ArrowLeft,
  Database,
  RefreshCw,
} from "lucide-react";
import {
  getStorage,
  getStorageStats,
  getSnapshots,
} from "@/lib/api";
import { formatBytes } from "@/lib/utils";

import { Breadcrumb } from "./components/breadcrumb";
import { ServerCard } from "./components/server-card";
import { RepoCard, RepoCardSkeleton } from "./components/repo-card";
import { SnapshotTable } from "./components/snapshot-table";

function ServerListView({
  onSelectServer,
}: {
  onSelectServer: (name: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["storage"],
    queryFn: getStorage,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Backup Servers</h1>
          <p className="text-muted-foreground">
            Configured backup destinations
          </p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {[1, 2].map((i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-32" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-32 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const storageList = data?.storage || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Backup Servers</h1>
        <p className="text-muted-foreground">
          {storageList.length} backup server
          {storageList.length !== 1 ? "s" : ""} configured
        </p>
      </div>

      {storageList.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <Server className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-medium">
                No backup servers configured
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Add backup servers via environment variables or config file.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2" data-testid="storage-list">
          {storageList.map((storage) => (
            <ServerCard
              key={storage.name}
              storage={storage}
              onSelect={onSelectServer}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ServerReposView({
  serverName,
  onBack,
  onSelectRepo,
}: {
  serverName: string;
  onBack: () => void;
  onSelectRepo: (repo: string) => void;
}) {
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["storage-stats", serverName],
    queryFn: () => getStorageStats(serverName),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Breadcrumb items={[{ label: serverName }]} />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold">{serverName}</h1>
              <p className="text-muted-foreground">
                Repositories on this backup server
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${isRefetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      {data && (
        <div className="grid grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{data.repoCount}</div>
              <p className="text-xs text-muted-foreground">Repositories</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">{data.totalSnapshots}</div>
              <p className="text-xs text-muted-foreground">Total Snapshots</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">
                {formatBytes(data.totalSize)}
              </div>
              <p className="text-xs text-muted-foreground">Total Size</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="text-2xl font-bold">
                {data.totalFileCount.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">Total Files</p>
            </CardContent>
          </Card>
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <RepoCardSkeleton count={3} />
        </div>
      ) : data?.repos.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <Database className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-medium">No repositories found</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                No backup repositories have been created on this server yet.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {data?.repos.map((repo) => (
            <RepoCard
              key={repo.repo}
              repo={repo}
              storageName={serverName}
              onSelect={onSelectRepo}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RepoSnapshotsView({
  serverName,
  repoName,
  onBack,
}: {
  serverName: string;
  repoName: string;
  onBack: () => void;
}) {
  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["snapshots", serverName, repoName],
    queryFn: () => getSnapshots(serverName, repoName),
  });

  const snapshots = data?.snapshots || [];

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <Breadcrumb
          items={[
            { label: serverName, href: `/storage?server=${serverName}` },
            { label: repoName },
          ]}
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="outline" size="icon" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold">{repoName}</h1>
              <p className="text-muted-foreground">
                Snapshots in this repository
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => refetch()}
            disabled={isRefetching}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${isRefetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Backup Snapshots</CardTitle>
          <CardDescription>
            {isLoading
              ? "Loading..."
              : `${snapshots.length} snapshot${snapshots.length !== 1 ? "s" : ""} available`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SnapshotTable
            snapshots={snapshots}
            storage={serverName}
            repo={repoName}
            isLoading={isLoading}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function BackupServersContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const selectedServer = searchParams.get("server");
  const selectedRepo = searchParams.get("repo");

  const navigateToServer = (server: string) => {
    router.push(`/storage?server=${encodeURIComponent(server)}`);
  };

  const navigateToRepo = (repo: string) => {
    router.push(
      `/storage?server=${encodeURIComponent(selectedServer!)}&repo=${encodeURIComponent(repo)}`
    );
  };

  const navigateBack = () => {
    if (selectedRepo) {
      router.push(`/storage?server=${encodeURIComponent(selectedServer!)}`);
    } else {
      router.push("/storage");
    }
  };

  const navigateToServerList = () => {
    router.push("/storage");
  };

  if (selectedServer && selectedRepo) {
    return (
      <RepoSnapshotsView
        serverName={selectedServer}
        repoName={selectedRepo}
        onBack={navigateBack}
      />
    );
  }

  if (selectedServer) {
    return (
      <ServerReposView
        serverName={selectedServer}
        onBack={navigateToServerList}
        onSelectRepo={navigateToRepo}
      />
    );
  }

  return <ServerListView onSelectServer={navigateToServer} />;
}

export default function BackupServersPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div>
            <Skeleton className="h-9 w-48" />
            <Skeleton className="mt-2 h-5 w-64" />
          </div>
          <div className="grid gap-6 md:grid-cols-2">
            {[1, 2].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-32" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-32 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      }
    >
      <BackupServersContent />
    </Suspense>
  );
}
