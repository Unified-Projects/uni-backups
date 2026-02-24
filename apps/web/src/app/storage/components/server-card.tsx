"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
  Server,
  Cloud,
  Folder,
  Database,
  HardDrive,
  CheckCircle,
  XCircle,
  RefreshCw,
  ChevronRight,
} from "lucide-react";
import {
  getStorageStatus,
  getStorageStats,
  type Storage,
  type StorageStats,
} from "@/lib/api";
import { formatBytes } from "@/lib/utils";
import { useToast } from "@uni-backups/ui/hooks/use-toast";

function StorageIcon({ type }: { type: Storage["type"] }) {
  switch (type) {
    case "sftp":
      return <Server className="h-5 w-5" />;
    case "s3":
      return <Cloud className="h-5 w-5" />;
    case "rest":
      return <Database className="h-5 w-5" />;
    case "local":
      return <Folder className="h-5 w-5" />;
    default:
      return <HardDrive className="h-5 w-5" />;
  }
}

function StorageTypeBadge({ type }: { type: Storage["type"] }) {
  const colors: Record<Storage["type"], string> = {
    sftp: "bg-blue-500/10 text-blue-500",
    s3: "bg-orange-500/10 text-orange-500",
    rest: "bg-purple-500/10 text-purple-500",
    local: "bg-green-500/10 text-green-500",
  };

  return (
    <Badge variant="outline" className={`storage-type-badge ${colors[type]}`}>
      {type.toUpperCase()}
    </Badge>
  );
}

interface ServerCardProps {
  storage: Storage;
  onSelect: (name: string) => void;
}

export function ServerCard({ storage, onSelect }: ServerCardProps) {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const { toast } = useToast();

  const statusMutation = useMutation({
    mutationFn: () => getStorageStatus(storage.name),
    onSuccess: (data) => {
      if (data.status === "connected") {
        toast({
          title: "Connection successful",
          description: `Backup server "${storage.name}" is accessible`,
          variant: "success",
        });
      } else {
        toast({
          title: "Connection failed",
          description: data.message || `Could not connect to "${storage.name}"`,
          variant: "destructive",
        });
      }
    },
    onError: (error) => {
      toast({
        title: "Connection test failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const statsMutation = useMutation({
    mutationFn: () => getStorageStats(storage.name),
    onSuccess: (data) => {
      setStats(data);
    },
    onError: (error) => {
      toast({
        title: "Failed to load stats",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  const getStorageDetails = () => {
    switch (storage.type) {
      case "sftp":
        return `${storage.host}:${storage.port || 22}${storage.path || "/"}`;
      case "s3":
        return `${storage.endpoint || "s3.amazonaws.com"}/${storage.bucket}${storage.path || ""}`;
      case "rest":
        return storage.url;
      case "local":
        return storage.path;
      default:
        return "Unknown";
    }
  };

  return (
    <Card className="storage-card group hover:border-primary/50 transition-colors">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-muted p-2">
              <StorageIcon type={storage.type} />
            </div>
            <div>
              <CardTitle className="text-lg">{storage.name}</CardTitle>
              <CardDescription className="font-mono text-xs">
                {getStorageDetails()}
              </CardDescription>
            </div>
          </div>
          <StorageTypeBadge type={storage.type} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Connection Status */}
        <div className="flex items-center justify-between" data-testid="storage-status">
          <span className="text-sm text-muted-foreground">Connection Status</span>
          {statusMutation.isPending ? (
            <Badge variant="outline">
              <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
              Checking...
            </Badge>
          ) : statusMutation.data ? (
            statusMutation.data.status === "connected" ? (
              <Badge variant="outline" className="bg-green-500/10 text-green-500">
                <CheckCircle className="mr-1 h-3 w-3" />
                Connected
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-red-500/10 text-red-500">
                <XCircle className="mr-1 h-3 w-3" />
                Error
              </Badge>
            )
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => statusMutation.mutate()}
            >
              Test Connection
            </Button>
          )}
        </div>

        {/* Quick Stats */}
        {!stats && !statsMutation.isPending && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => statsMutation.mutate()}
          >
            Load Statistics
          </Button>
        )}

        {statsMutation.isPending && (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {stats && (
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-muted/50 p-2 text-center">
              <p className="text-xs text-muted-foreground">Repos</p>
              <p className="text-lg font-semibold">{stats.repoCount}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-2 text-center">
              <p className="text-xs text-muted-foreground">Snapshots</p>
              <p className="text-lg font-semibold">{stats.totalSnapshots}</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-2 text-center">
              <p className="text-xs text-muted-foreground">Size</p>
              <p className="text-lg font-semibold">{formatBytes(stats.totalSize)}</p>
            </div>
          </div>
        )}

        {/* Error Message */}
        {statusMutation.data?.status === "error" && statusMutation.data.message && (
          <p className="text-sm text-red-500 bg-red-500/10 rounded-lg p-2">
            {statusMutation.data.message}
          </p>
        )}

        {/* View Repos Button */}
        <Button
          className="w-full"
          onClick={() => onSelect(storage.name)}
        >
          View Repositories
          <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
