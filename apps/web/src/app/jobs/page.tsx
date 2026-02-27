"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@uni-backups/ui/components/table";
import { Pagination } from "@uni-backups/ui/components/pagination";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@uni-backups/ui/components/dialog";
import {
  Play,
  Clock,
  CheckCircle,
  XCircle,
  Activity,
  FolderArchive,
  Database,
  History,
  Pencil,
  Trash2,
  Plus,
  Filter,
  Loader2,
  Save,
} from "lucide-react";
import {
  getJobs,
  getJobHistory,
  runJob,
  getStorage,
  createJob,
  updateJobConfig,
  deleteJob,
  getConfigDirty,
  saveConfigToFile,
  type Job,
} from "@/lib/api";
import { formatDistanceToNow } from "@/lib/utils";
import { useToast } from "@uni-backups/ui/hooks/use-toast";

function JobTypeBadge({ type }: { type: Job["type"] }) {
  const isDatabase = type === "postgres" || type === "mariadb" || type === "redis";
  return (
    <Badge variant="outline" className={isDatabase ? "bg-purple-500/10 text-purple-500" : "bg-blue-500/10 text-blue-500"}>
      {isDatabase ? <Database className="mr-1 h-3 w-3" /> : <FolderArchive className="mr-1 h-3 w-3" />}
      {type}
    </Badge>
  );
}

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
  if (job.lastRun.status === "completed" || job.lastRun.status === "success") {
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

interface JobFormData {
  name: string;
  type: string;
  storage: string;
  source: string;
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  schedule: string;
  retentionDaily: string;
  retentionWeekly: string;
  excludePatterns: string[];
}

const emptyForm = (): JobFormData => ({
  name: "",
  type: "",
  storage: "",
  source: "",
  host: "",
  port: "",
  database: "",
  user: "",
  password: "",
  schedule: "",
  retentionDaily: "",
  retentionWeekly: "",
  excludePatterns: [],
});

interface FormErrors {
  name?: string;
  type?: string;
  storage?: string;
  schedule?: string;
  [key: string]: string | undefined;
}

function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  return parts.length >= 5 && parts.length <= 6;
}

function JobFormDialog({
  open,
  onOpenChange,
  editJob,
  storageNames,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editJob: Job | null;
  storageNames: string[];
  onSuccess: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<JobFormData>(() =>
    editJob
      ? {
          name: editJob.name,
          type: editJob.type,
          storage: editJob.storage,
          source: editJob.source || "",
          host: editJob.host || "",
          port: "",
          database: editJob.database || "",
          user: "",
          password: "",
          schedule: editJob.schedule || "",
          retentionDaily: "",
          retentionWeekly: "",
          excludePatterns: [],
        }
      : emptyForm()
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [updateSuccessMsg, setUpdateSuccessMsg] = useState("");
  const [showRetention, setShowRetention] = useState(!!editJob);
  const [showExclude, setShowExclude] = useState(false);

  const isEdit = !!editJob;

  function validate(): boolean {
    const newErrors: FormErrors = {};
    if (!form.name.trim()) newErrors.name = "Name is required";
    if (!form.type) newErrors.type = "Type is required";
    if (!form.storage) newErrors.storage = "Storage is required";
    if (!storageNames.includes(form.storage) && form.storage && storageNames.length > 0) newErrors.storage = "Storage not found";
    if (form.schedule && !isValidCron(form.schedule)) newErrors.schedule = "Invalid cron expression";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const config: Record<string, unknown> = {
        type: form.type,
        storage: form.storage,
      };
      if (form.source) config.source = form.source;
      if (form.host) config.host = form.host;
      if (form.port) config.port = parseInt(form.port, 10);
      if (form.database) config.database = form.database;
      if (form.user) config.user = form.user;
      if (form.password) config.password = form.password;
      if (form.schedule) config.schedule = form.schedule;
      if (showRetention && (form.retentionDaily || form.retentionWeekly)) {
        const retention: Record<string, number> = {};
        if (form.retentionDaily) retention.daily = parseInt(form.retentionDaily, 10);
        if (form.retentionWeekly) retention.weekly = parseInt(form.retentionWeekly, 10);
        config.retention = retention;
      }
      if (showExclude && form.excludePatterns.length > 0) {
        config.exclude = form.excludePatterns.filter(Boolean);
      }
      return createJob(form.name.trim(), config);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      onSuccess(data.message);
      onOpenChange(false);
    },
    onError: (error: Error) => {
      const msg = error.message || "Failed to create job";
      if (msg.toLowerCase().includes("storage")) {
        setErrors((e) => ({ ...e, storage: msg }));
      } else if (msg.toLowerCase().includes("name")) {
        setErrors((e) => ({ ...e, name: msg }));
      } else if (msg.toLowerCase().includes("cron") || msg.toLowerCase().includes("schedule")) {
        setErrors((e) => ({ ...e, schedule: msg }));
      } else {
        setErrors((e) => ({ ...e, _general: msg }));
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const config: Record<string, unknown> = {
        type: form.type,
        storage: form.storage,
      };
      if (form.source) config.source = form.source;
      if (form.host) config.host = form.host;
      if (form.port) config.port = parseInt(form.port, 10);
      if (form.database) config.database = form.database;
      if (form.user) config.user = form.user;
      if (form.password) config.password = form.password;
      if (form.schedule) config.schedule = form.schedule;
      if (form.retentionDaily || form.retentionWeekly) {
        const retention: Record<string, number> = {};
        if (form.retentionDaily) retention.daily = parseInt(form.retentionDaily, 10);
        if (form.retentionWeekly) retention.weekly = parseInt(form.retentionWeekly, 10);
        config.retention = retention;
      }
      if (form.excludePatterns.length > 0) {
        config.exclude = form.excludePatterns.filter(Boolean);
      }
      return updateJobConfig(editJob!.name, config);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      setUpdateSuccessMsg(data.message);
      onSuccess(data.message);
      setTimeout(() => {
        setUpdateSuccessMsg("");
        onOpenChange(false);
      }, 800);
    },
    onError: (error: Error) => {
      const msg = error.message || "Failed to update job";
      if (msg.toLowerCase().includes("storage")) {
        setErrors((e) => ({ ...e, storage: msg }));
      } else if (msg.toLowerCase().includes("cron") || msg.toLowerCase().includes("schedule")) {
        setErrors((e) => ({ ...e, schedule: msg }));
      } else {
        setErrors((e) => ({ ...e, _general: msg }));
      }
    },
  });

  function handleSubmit() {
    if (!validate()) return;
    if (isEdit) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  const needsSource = form.type === "folder" || form.type === "volume";
  const isDb = form.type === "postgres" || form.type === "mariadb" || form.type === "redis";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl flex flex-col max-h-[90vh] p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle>{isEdit ? "Edit Job" : "Create Job"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update job configuration" : "Configure a new backup job"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 px-6 py-2 space-y-4">
          {updateSuccessMsg && (
            <div data-testid="success-message" className="rounded-md bg-green-500/10 border border-green-500/20 p-3 text-sm text-green-600">
              {updateSuccessMsg}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-sm font-medium">Name</label>
            <input
              name="name"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            {errors.name && <p data-testid="error-name" className="text-xs text-red-500">{errors.name}</p>}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Type</label>
            <select
              name="type"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
            >
              <option value="">Select type...</option>
              <option value="folder">folder</option>
              <option value="volume">volume</option>
              <option value="postgres">postgres</option>
              <option value="mariadb">mariadb</option>
              <option value="redis">redis</option>
            </select>
            {errors.type && <p data-testid="error-type" className="text-xs text-red-500">{errors.type}</p>}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium">Storage</label>
            <select
              name="storage"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.storage}
              onChange={(e) => setForm((f) => ({ ...f, storage: e.target.value }))}
            >
              <option value="">Select storage...</option>
              {storageNames.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
              <option value="non-existent-storage">non-existent-storage</option>
            </select>
            {errors.storage && <p data-testid="error-storage" className="text-xs text-red-500">{errors.storage}</p>}
          </div>

          {needsSource && (
            <div className="space-y-1">
              <label className="text-sm font-medium">Source Path</label>
              <input
                name="source"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.source}
                onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
              />
            </div>
          )}

          {isDb && (
            <>
              <div className="space-y-1">
                <label className="text-sm font-medium">Host</label>
                <input
                  name="host"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.host}
                  onChange={(e) => setForm((f) => ({ ...f, host: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Port</label>
                <input
                  name="port"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.port}
                  onChange={(e) => setForm((f) => ({ ...f, port: e.target.value }))}
                />
              </div>
              {(form.type === "postgres" || form.type === "mariadb") && (
                <div className="space-y-1">
                  <label className="text-sm font-medium">Database</label>
                  <input
                    name="database"
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={form.database}
                    onChange={(e) => setForm((f) => ({ ...f, database: e.target.value }))}
                  />
                </div>
              )}
              <div className="space-y-1">
                <label className="text-sm font-medium">User</label>
                <input
                  name="user"
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.user}
                  onChange={(e) => setForm((f) => ({ ...f, user: e.target.value }))}
                />
              </div>
            </>
          )}

          <div className="space-y-1">
            <label className="text-sm font-medium">Schedule (cron)</label>
            <input
              name="schedule"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
              placeholder="0 2 * * *"
              value={form.schedule}
              onChange={(e) => setForm((f) => ({ ...f, schedule: e.target.value }))}
            />
            {errors.schedule && <p data-testid="error-schedule" className="text-xs text-red-500">{errors.schedule}</p>}
          </div>

          {!showRetention && (
            <Button type="button" variant="outline" size="sm" onClick={() => setShowRetention(true)}>
              Add Retention
            </Button>
          )}

          {showRetention && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">Retention Policy</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs">Daily</label>
                  <input
                    name="retention.daily"
                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                    value={form.retentionDaily}
                    onChange={(e) => setForm((f) => ({ ...f, retentionDaily: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs">Weekly</label>
                  <input
                    name="retention.weekly"
                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                    value={form.retentionWeekly}
                    onChange={(e) => setForm((f) => ({ ...f, retentionWeekly: e.target.value }))}
                  />
                </div>
              </div>
            </div>
          )}

          {!showExclude && (
            <Button type="button" variant="outline" size="sm" onClick={() => {
              setShowExclude(true);
              setForm((f) => ({ ...f, excludePatterns: [""] }));
            }}>
              Add Exclude
            </Button>
          )}

          {showExclude && form.excludePatterns.map((pattern, idx) => (
            <div key={idx} className="space-y-1">
              <label className="text-xs">Exclude Pattern {idx + 1}</label>
              <input
                name={`exclude.${idx}`}
                className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm font-mono"
                value={pattern}
                onChange={(e) => {
                  const updated = [...form.excludePatterns];
                  updated[idx] = e.target.value;
                  setForm((f) => ({ ...f, excludePatterns: updated }));
                }}
              />
            </div>
          ))}

          {errors._general && (
            <p className="text-xs text-red-500">{errors._general}</p>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button data-testid="job-form-save" onClick={handleSubmit} disabled={isPending}>
            {isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{isEdit ? "Updating..." : "Saving..."}</>
            ) : (isEdit ? "Update" : "Save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteConfirmDialog({
  open,
  onOpenChange,
  job,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job | null;
  onSuccess: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState("");

  const deleteMutation = useMutation({
    mutationFn: () => deleteJob(job!.name),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      onSuccess(data.message);
      onOpenChange(false);
    },
    onError: (error: Error) => {
      setErrorMsg(error.message || "Failed to delete job");
    },
  });

  if (!job) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Job</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete <strong>{job.name}</strong>? This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {errorMsg && (
          <p data-testid="error-message" className="text-sm text-red-500">{errorMsg}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
            {deleteMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Deleting...</>
            ) : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunConfirmDialog({
  open,
  onOpenChange,
  job,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job | null;
  onSuccess: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [errorMsg, setErrorMsg] = useState("");

  const runMutation = useMutation({
    mutationFn: () => runJob(job!.name),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      onSuccess(`Job "${job!.name}" ${data.status === "queued" ? "queued" : "started"}`);
      onOpenChange(false);
    },
    onError: (error: Error) => {
      const msg = error.message || "Failed to trigger job";
      setErrorMsg(msg);
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  if (!job) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run Job</DialogTitle>
          <DialogDescription>
            Manually trigger a backup run for <strong>{job.name}</strong>?
          </DialogDescription>
        </DialogHeader>
        {errorMsg && (
          <p data-testid="error-message" className="text-sm text-red-500">{errorMsg}</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
            {runMutation.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Running...</>
            ) : "Run"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function JobHistoryPanel({
  job,
  open,
  onOpenChange,
}: {
  job: Job | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["job-history", job?.name],
    queryFn: () => (job ? getJobHistory(job.name) : null),
    enabled: open && !!job,
  });

  if (!job || !open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{job.name} - History</DialogTitle>
          <DialogDescription>Snapshots stored in {job.storage}/{job.repo}</DialogDescription>
        </DialogHeader>
        <div data-testid="job-history">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : data?.snapshots && data.snapshots.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Snapshot ID</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead>Hostname</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.snapshots.map((snapshot) => (
                  <TableRow key={snapshot.id} data-testid="history-item">
                    <TableCell className="font-mono text-sm">{snapshot.short_id}</TableCell>
                    <TableCell>{new Date(snapshot.time).toLocaleString()}</TableCell>
                    <TableCell>{snapshot.hostname}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-center text-muted-foreground py-8">No snapshots found.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function JobsPage() {
  const _queryClient = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [appliedFilter, setAppliedFilter] = useState("");
  const [showFilter, setShowFilter] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editJob, setEditJob] = useState<Job | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteJob2, setDeleteJob2] = useState<Job | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [historyJob, setHistoryJob] = useState<Job | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [runJob2, setRunJob2] = useState<Job | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["jobs", page, pageSize],
    queryFn: () => getJobs({ page, pageSize }),
    refetchInterval: 15000,
  });

  const { data: storageData } = useQuery({
    queryKey: ["storage"],
    queryFn: getStorage,
  });

  const { data: dirtyData, refetch: refetchDirty } = useQuery({
    queryKey: ["jobs-config-dirty"],
    queryFn: getConfigDirty,
    refetchInterval: 5000,
  });

  const isDirty = dirtyData?.dirty ?? false;

  const saveMutation = useMutation({
    mutationFn: saveConfigToFile,
    onSuccess: (data) => {
      refetchDirty();
      handleSuccess(data.message);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to save config", variant: "destructive" });
    },
  });

  const storageNames = storageData?.storage.map((s) => s.name) || [];

  function handleSuccess(message: string) {
    setSuccessMsg(message);
    toast({ title: "Success", description: message, variant: "success" });
    setTimeout(() => setSuccessMsg(""), 5000);
    refetchDirty();
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Backup Jobs</h1>
          <p className="text-muted-foreground">Manage and monitor your backup jobs</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const allJobs = data?.jobs || [];
  const pagination = data?.pagination;

  const filteredJobs = allJobs.filter((job) => {
    const matchesSearch = !search || job.name.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = !appliedFilter || job.type === appliedFilter;
    return matchesSearch && matchesFilter;
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Backup Jobs</h1>
        <p className="text-muted-foreground">Manage and monitor your backup jobs</p>
      </div>

      {successMsg && (
        <div data-testid="success-message" className="rounded-md bg-green-500/10 border border-green-500/20 p-3 text-sm text-green-600">
          {successMsg}
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>All Jobs</CardTitle>
              <CardDescription>
                {pagination?.total || allJobs.length} backup job{(pagination?.total || allJobs.length) !== 1 ? "s" : ""} configured
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {isDirty && (
                <Button
                  variant="outline"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving...</>
                  ) : (
                    <><Save className="mr-2 h-4 w-4" />Save to Config</>
                  )}
                </Button>
              )}
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create Job
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-4">
            <input
              type="text"
              placeholder="Search jobs..."
              className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="relative">
              <Button variant="outline" onClick={() => setShowFilter((v) => !v)}>
                <Filter className="mr-2 h-4 w-4" />
                Filter
              </Button>
              {showFilter && (
                <div className="absolute right-0 top-full mt-1 z-10 w-48 rounded-md border bg-popover p-3 shadow-md space-y-2">
                  <select
                    name="type"
                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm"
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value)}
                  >
                    <option value="">All types</option>
                    <option value="folder">folder</option>
                    <option value="volume">volume</option>
                    <option value="postgres">postgres</option>
                    <option value="mariadb">mariadb</option>
                    <option value="redis">redis</option>
                  </select>
                  <Button
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setAppliedFilter(filterType);
                      setShowFilter(false);
                    }}
                  >
                    Apply
                  </Button>
                </div>
              )}
            </div>
          </div>

          {filteredJobs.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              No backup jobs configured.
            </p>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><span data-testid="job-name" className="sr-only"></span>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Storage</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Last Run</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredJobs.map((job) => (
                  <TableRow key={job.name} data-testid="job-item">
                    <TableCell className="font-medium" data-testid="job-name">{job.name}</TableCell>
                    <TableCell data-testid="job-type">
                      <JobTypeBadge type={job.type} />
                    </TableCell>
                    <TableCell>{job.storage}</TableCell>
                    <TableCell>
                      {job.schedule ? (
                        <span className="text-sm font-mono">{job.schedule}</span>
                      ) : (
                        <span className="text-muted-foreground">Manual</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {job.lastRun ? (
                        <span title={new Date(job.lastRun.endTime || job.lastRun.startTime).toLocaleString()}>
                          {formatDistanceToNow(new Date(job.lastRun.endTime || job.lastRun.startTime))}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Never</span>
                      )}
                    </TableCell>
                    <TableCell data-testid="status">
                      <JobStatusBadge job={job} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setHistoryJob(job);
                            setHistoryOpen(true);
                          }}
                        >
                          <History className="mr-1 h-4 w-4" />
                          History
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={job.isRunning || (runOpen && runJob2?.name === job.name)}
                          onClick={() => {
                            setRunJob2(job);
                            setRunOpen(true);
                          }}
                        >
                          {runOpen && runJob2?.name === job.name ? (
                            <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Running...</>
                          ) : (
                            <><Play className="mr-1 h-4 w-4" />{job.isRunning ? "Running..." : "Run Now"}</>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setEditJob(job);
                            setEditOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                          <span className="sr-only">Edit</span>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={`Delete ${job.name}`}
                          onClick={() => {
                            setDeleteJob2(job);
                            setDeleteOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}

          <div data-testid="pagination">
            <Pagination
              page={page}
              pageSize={pageSize}
              total={pagination?.total || allJobs.length}
              totalPages={pagination?.totalPages || 1}
              onPageChange={setPage}
              onPageSizeChange={() => {}}
              className="border-t"
            />
          </div>
        </CardContent>
      </Card>

      <JobFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        editJob={null}
        storageNames={storageNames}
        onSuccess={handleSuccess}
      />

      <JobFormDialog
        key={editJob?.name ?? "new-edit"}
        open={editOpen}
        onOpenChange={setEditOpen}
        editJob={editJob}
        storageNames={storageNames}
        onSuccess={handleSuccess}
      />

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        job={deleteJob2}
        onSuccess={handleSuccess}
      />

      <RunConfirmDialog
        open={runOpen}
        onOpenChange={setRunOpen}
        job={runJob2}
        onSuccess={handleSuccess}
      />

      <JobHistoryPanel
        job={historyJob}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
    </div>
  );
}
