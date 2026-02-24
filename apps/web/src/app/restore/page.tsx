"use client";

import { useState, useEffect, Suspense } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { Input } from "@uni-backups/ui/components/input";
import { Label } from "@uni-backups/ui/components/label";
import { Skeleton as _Skeleton } from "@uni-backups/ui/components/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@uni-backups/ui/components/select";
import { RadioGroup, RadioGroupItem } from "@uni-backups/ui/components/radio-group";
import {
  Download,
  FolderInput,
  CheckCircle,
  XCircle,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import {
  getStorage,
  getStorageRepos,
  getSnapshots,
  initiateRestore,
  getRestoreStatus,
  getRestoreOperations,
  type RestoreOperation,
} from "@/lib/api";
import { useToast } from "@uni-backups/ui/hooks/use-toast";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

function RestoreStatusBadge({ status }: { status: RestoreOperation["status"] }) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          Pending
        </Badge>
      );
    case "running":
      return (
        <Badge variant="outline" className="bg-blue-500/10 text-blue-500">
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
          Running
        </Badge>
      );
    case "completed":
      return (
        <Badge variant="outline" className="bg-green-500/10 text-green-500">
          <CheckCircle className="mr-1 h-3 w-3" />
          Completed
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

function RestoreContent() {
  const searchParams = useSearchParams();
  const { toast } = useToast();

  const [storage, setStorage] = useState(searchParams.get("storage") || "");
  const [repo, setRepo] = useState(searchParams.get("repo") || "");
  const [snapshot, setSnapshot] = useState(searchParams.get("snapshot") || "");
  const [method, setMethod] = useState<"download" | "path">("download");
  const [targetPath, setTargetPath] = useState("");
  const [paths, setPaths] = useState(searchParams.get("path") || "");
  const [validationError, setValidationError] = useState<string | null>(null);

  const [activeRestoreId, setActiveRestoreId] = useState<string | null>(null);

  const { data: storageData } = useQuery({
    queryKey: ["storage"],
    queryFn: getStorage,
  });

  const { data: reposData } = useQuery({
    queryKey: ["storage-repos", storage],
    queryFn: () => getStorageRepos(storage),
    enabled: !!storage,
  });

  const { data: snapshotsData } = useQuery({
    queryKey: ["snapshots", storage, repo],
    queryFn: () => getSnapshots(storage, repo),
    enabled: !!storage && !!repo,
  });

  const { data: operationsData, refetch: refetchOperations } = useQuery({
    queryKey: ["restore-operations"],
    queryFn: getRestoreOperations,
    refetchInterval: 15000,
  });

  const { data: activeRestoreStatus } = useQuery({
    queryKey: ["restore-status", activeRestoreId],
    queryFn: () => getRestoreStatus(activeRestoreId!),
    enabled: !!activeRestoreId,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data?.status === "pending" || data?.status === "running" ? 2000 : false;
    },
  });

  const restoreMutation = useMutation({
    mutationFn: initiateRestore,
    onSuccess: (data) => {
      setActiveRestoreId(data.id);
      refetchOperations();
      toast({
        title: "Restore initiated",
        description: "Your restore operation has started",
        variant: "success",
      });
    },
    onError: (error) => {
      toast({
        title: "Restore failed",
        description: error instanceof Error ? error.message : "Could not start restore",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (activeRestoreStatus?.status === "completed" && activeRestoreStatus.downloadReady) {
      toast({
        title: "Restore complete",
        description: "Your download will begin shortly",
        variant: "success",
      });
      // Trigger download
      window.open(`${API_URL}/api/restore/${activeRestoreId}/download`, "_blank");
    } else if (activeRestoreStatus?.status === "completed" && !activeRestoreStatus.downloadReady) {
      toast({
        title: "Restore complete",
        description: "Files have been restored to the target path",
        variant: "success",
      });
    } else if (activeRestoreStatus?.status === "failed") {
      toast({
        title: "Restore failed",
        description: activeRestoreStatus.message || "The restore operation failed",
        variant: "destructive",
      });
    }
  }, [activeRestoreStatus, activeRestoreId, toast]);

  const storageList = storageData?.storage || [];
  const repos = reposData?.repos || [];
  const snapshots = snapshotsData?.snapshots || [];
  const operations = operationsData?.operations || [];

  const handleSubmit = () => {
    setValidationError(null);
    if (!storage) {
      setValidationError("Please select a storage backend");
      return;
    }
    if (!repo) {
      setValidationError("Please select a repository");
      return;
    }
    if (!snapshot) {
      setValidationError("Please select a snapshot");
      return;
    }
    if (method === "path" && targetPath && !targetPath.startsWith("/")) {
      setValidationError("Target path must be an absolute path (start with /)");
      return;
    }
    restoreMutation.mutate({
      storage,
      repo,
      snapshotId: snapshot,
      paths: paths ? paths.split(",").map((p) => p.trim()) : undefined,
      method,
      target: method === "path" ? targetPath : undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Restore</h1>
        <p className="text-muted-foreground">Restore files from backup snapshots</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="restore-wizard">
          <CardHeader>
            <CardTitle>New Restore</CardTitle>
            <CardDescription>Select a snapshot and restore method</CardDescription>
          </CardHeader>
          <CardContent>
          <form data-testid="restore-form" onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Storage</Label>
                {/* Hidden native select for test automation */}
                <select
                  name="storage"
                  className="sr-only"
                  value={storage}
                  onChange={(e) => {
                    setStorage(e.target.value);
                    setRepo("");
                    setSnapshot("");
                  }}
                  aria-label="Storage backend"
                >
                  <option value="">Select storage</option>
                  {storageList.map((s) => (
                    <option key={s.name} value={s.name}>{s.name}</option>
                  ))}
                </select>
                <Select
                  value={storage}
                  onValueChange={(v) => {
                    setStorage(v);
                    setRepo("");
                    setSnapshot("");
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
                <Label>Repository</Label>
                <Select
                  value={repo}
                  onValueChange={(v) => {
                    setRepo(v);
                    setSnapshot("");
                  }}
                  disabled={!storage}
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
                <Label>Snapshot</Label>
                <Select
                  value={snapshot}
                  onValueChange={setSnapshot}
                  disabled={!repo}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select snapshot" />
                  </SelectTrigger>
                  <SelectContent>
                    {snapshots.map((s) => (
                      <SelectItem key={s.id} value={s.short_id}>
                        {s.short_id} - {new Date(s.time).toLocaleDateString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Paths (optional)</Label>
                <Input
                  value={paths}
                  onChange={(e) => setPaths(e.target.value)}
                  placeholder="e.g., /data/file.txt, /config (comma-separated)"
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to restore all files
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <Label>Restore Method</Label>
              <RadioGroup
                value={method}
                onValueChange={(v) => setMethod(v as "download" | "path")}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="download" id="download" />
                  <Label htmlFor="download" className="flex items-center gap-2 cursor-pointer">
                    <Download className="h-4 w-4" />
                    Download as archive
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="path" id="path" />
                  <Label htmlFor="path" className="flex items-center gap-2 cursor-pointer">
                    <FolderInput className="h-4 w-4" />
                    Restore to path
                  </Label>
                </div>
              </RadioGroup>

              <div className="space-y-2">
                <Label>Target Path</Label>
                <Input
                  name="targetPath"
                  value={targetPath}
                  onChange={(e) => setTargetPath(e.target.value)}
                  placeholder="/path/to/restore"
                />
                <p className="text-xs text-muted-foreground">
                  Path must be mounted in the container
                </p>
              </div>
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={restoreMutation.isPending}
            >
              {restoreMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Starting restore...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Start Restore
                </>
              )}
            </Button>

            {validationError && (
              <div role="alert" className="error validation-error rounded-lg bg-red-500/10 p-3 text-sm text-red-500">
                <AlertTriangle className="mr-2 inline h-4 w-4" />
                {validationError}
              </div>
            )}

            {restoreMutation.error && (
              <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-500">
                <AlertTriangle className="mr-2 inline h-4 w-4" />
                {restoreMutation.error.message}
              </div>
            )}

            {activeRestoreStatus && (
              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Restore in progress</span>
                  <RestoreStatusBadge status={activeRestoreStatus.status} />
                </div>
                {activeRestoreStatus.message && (
                  <p className="text-sm text-muted-foreground">
                    {activeRestoreStatus.message}
                  </p>
                )}
                {activeRestoreStatus.status === "completed" && activeRestoreStatus.downloadReady && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      window.open(`${API_URL}/api/restore/${activeRestoreId}/download`, "_blank")
                    }
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download Archive
                  </Button>
                )}
              </div>
            )}
          </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Restores</CardTitle>
            <CardDescription>History of restore operations</CardDescription>
          </CardHeader>
          <CardContent>
            {operations.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No restore operations yet
              </p>
            ) : (
              <div className="space-y-3">
                {operations.map((op) => (
                  <div
                    key={op.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                  >
                    <div className="space-y-1">
                      <p className="font-medium font-mono text-sm">
                        {op.snapshotId.slice(0, 8)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {op.storage}/{op.repo}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(op.startTime).toLocaleString()}
                      </p>
                    </div>
                    <RestoreStatusBadge status={op.status} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function RestorePage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center p-8">Loading...</div>}>
      <RestoreContent />
    </Suspense>
  );
}
