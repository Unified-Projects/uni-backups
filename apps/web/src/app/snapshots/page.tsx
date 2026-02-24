"use client";

import { useState, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@uni-backups/ui/components/card";
import { Button } from "@uni-backups/ui/components/button";
import { Badge } from "@uni-backups/ui/components/badge";
import { Skeleton } from "@uni-backups/ui/components/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uni-backups/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@uni-backups/ui/components/table";
import {
  Folder,
  File,
  ChevronRight,
  ArrowUp,
  Download,
} from "lucide-react";
import Link from "next/link";
import {
  getStorage,
  getStorageRepos,
  getSnapshots,
  listSnapshotFiles,
  type FileEntry,
} from "@/lib/api";
import { formatBytes } from "@/lib/utils";

function FileIcon({ type }: { type: FileEntry["type"] }) {
  if (type === "dir") {
    return <Folder className="h-4 w-4 text-blue-500" />;
  }
  return <File className="h-4 w-4 text-muted-foreground" />;
}

function FileBrowser({
  storage,
  repo,
  snapshotId,
}: {
  storage: string;
  repo: string;
  snapshotId: string;
}) {
  const [currentPath, setCurrentPath] = useState("/");

  const { data, isLoading } = useQuery({
    queryKey: ["snapshot-files", storage, repo, snapshotId, currentPath],
    queryFn: () => listSnapshotFiles(storage, repo, snapshotId, currentPath),
  });

  const navigateTo = (path: string) => {
    setCurrentPath(path);
  };

  const goUp = () => {
    const parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    setCurrentPath("/" + parts.join("/"));
  };

  const breadcrumbs = currentPath.split("/").filter(Boolean);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  const entries = data?.entries || [];
  const dirs = entries.filter((e) => e.type === "dir").sort((a, b) => a.name.localeCompare(b.name));
  const files = entries.filter((e) => e.type !== "dir").sort((a, b) => a.name.localeCompare(b.name));
  const sortedEntries = [...dirs, ...files];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 text-sm">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2"
          onClick={() => setCurrentPath("/")}
        >
          /
        </Button>
        {breadcrumbs.map((part, index) => (
          <div key={index} className="flex items-center">
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2"
              onClick={() =>
                setCurrentPath("/" + breadcrumbs.slice(0, index + 1).join("/"))
              }
            >
              {part}
            </Button>
          </div>
        ))}
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="w-32">Size</TableHead>
              <TableHead className="w-48">Modified</TableHead>
              <TableHead className="w-24">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {currentPath !== "/" && (
              <TableRow
                className="cursor-pointer hover:bg-muted/50"
                onClick={goUp}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <ArrowUp className="h-4 w-4 text-muted-foreground" />
                    <span>..</span>
                  </div>
                </TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
                <TableCell></TableCell>
              </TableRow>
            )}
            {sortedEntries.map((entry) => (
              <TableRow
                key={entry.path}
                className={entry.type === "dir" ? "cursor-pointer hover:bg-muted/50" : ""}
                onClick={() => {
                  if (entry.type === "dir") {
                    navigateTo(entry.path);
                  }
                }}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <FileIcon type={entry.type} />
                    <span>{entry.name}</span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {entry.type !== "dir" ? formatBytes(entry.size) : "-"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(entry.mtime).toLocaleString()}
                </TableCell>
                <TableCell>
                  {entry.type !== "dir" && (
                    <Link
                      href={`/restore?storage=${storage}&repo=${repo}&snapshot=${snapshotId}&path=${encodeURIComponent(entry.path)}`}
                    >
                      <Button variant="ghost" size="sm">
                        <Download className="h-4 w-4" />
                      </Button>
                    </Link>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {sortedEntries.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  This directory is empty
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SnapshotsContent() {
  const searchParams = useSearchParams();
  const initialStorage = searchParams.get("storage") || "";
  const initialRepo = searchParams.get("repo") || "";
  const initialSnapshot = searchParams.get("id") || "";

  const [selectedStorage, setSelectedStorage] = useState(initialStorage);
  const [selectedRepo, setSelectedRepo] = useState(initialRepo);
  const [selectedSnapshot, setSelectedSnapshot] = useState(initialSnapshot);

  const { data: storageData } = useQuery({
    queryKey: ["storage"],
    queryFn: getStorage,
  });

  const { data: reposData } = useQuery({
    queryKey: ["storage-repos", selectedStorage],
    queryFn: () => getStorageRepos(selectedStorage),
    enabled: !!selectedStorage,
  });

  const { data: snapshotsData, isLoading: snapshotsLoading } = useQuery({
    queryKey: ["snapshots", selectedStorage, selectedRepo],
    queryFn: () => getSnapshots(selectedStorage, selectedRepo),
    enabled: !!selectedStorage && !!selectedRepo,
  });

  const storageList = storageData?.storage || [];
  const repos = reposData?.repos || [];
  const snapshots = snapshotsData?.snapshots || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Snapshots</h1>
        <p className="text-muted-foreground">Browse backup snapshots and files</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select Snapshot</CardTitle>
          <CardDescription>Choose a storage, repository, and snapshot to browse</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Storage</label>
              <Select
                value={selectedStorage}
                onValueChange={(v) => {
                  setSelectedStorage(v);
                  setSelectedRepo("");
                  setSelectedSnapshot("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select storage" />
                </SelectTrigger>
                <SelectContent>
                  {storageList.map((s) => (
                    <SelectItem key={s.name} value={s.name}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Repository</label>
              <Select
                value={selectedRepo}
                onValueChange={(v) => {
                  setSelectedRepo(v);
                  setSelectedSnapshot("");
                }}
                disabled={!selectedStorage}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select repository" />
                </SelectTrigger>
                <SelectContent>
                  {repos.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Snapshot</label>
              <Select
                value={selectedSnapshot}
                onValueChange={setSelectedSnapshot}
                disabled={!selectedRepo || snapshotsLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select snapshot" />
                </SelectTrigger>
                <SelectContent>
                  {snapshots.map((s) => (
                    <SelectItem key={s.id} value={s.short_id}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono">{s.short_id}</span>
                        <span className="text-muted-foreground">
                          {new Date(s.time).toLocaleDateString()}
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedSnapshot && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>
                  Snapshot {selectedSnapshot}
                </CardTitle>
                <CardDescription>
                  {selectedStorage}/{selectedRepo}
                </CardDescription>
              </div>
              <Link
                href={`/restore?storage=${selectedStorage}&repo=${selectedRepo}&snapshot=${selectedSnapshot}`}
              >
                <Button>
                  <Download className="mr-2 h-4 w-4" />
                  Restore
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <FileBrowser
              storage={selectedStorage}
              repo={selectedRepo}
              snapshotId={selectedSnapshot}
            />
          </CardContent>
        </Card>
      )}

      {selectedRepo && !selectedSnapshot && snapshots.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Available Snapshots</CardTitle>
            <CardDescription>
              {snapshots.length} snapshot{snapshots.length !== 1 ? "s" : ""} in {selectedRepo}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Hostname</TableHead>
                  <TableHead>Tags</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshots.map((snapshot) => (
                  <TableRow key={snapshot.id}>
                    <TableCell className="font-mono">{snapshot.short_id}</TableCell>
                    <TableCell>{new Date(snapshot.time).toLocaleString()}</TableCell>
                    <TableCell>{snapshot.hostname}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {snapshot.tags?.map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedSnapshot(snapshot.short_id)}
                      >
                        Browse
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function SnapshotsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center p-8">Loading...</div>}>
      <SnapshotsContent />
    </Suspense>
  );
}
