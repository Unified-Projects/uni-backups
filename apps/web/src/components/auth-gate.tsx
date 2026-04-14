"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@uni-backups/ui/components/card";
import { Input } from "@uni-backups/ui/components/input";
import { Button } from "@uni-backups/ui/components/button";
import { Label } from "@uni-backups/ui/components/label";
import { Skeleton } from "@uni-backups/ui/components/skeleton";
import { LockKeyhole, ShieldAlert } from "lucide-react";
import { getAuthSession, loginWithToken } from "@/lib/api";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sessionQuery = useQuery({
    queryKey: ["auth-session"],
    queryFn: getAuthSession,
    retry: false,
    staleTime: 30_000,
  });

  const loginMutation = useMutation({
    mutationFn: loginWithToken,
    onSuccess: async () => {
      setToken("");
      setErrorMessage(null);
      await queryClient.invalidateQueries({ queryKey: ["auth-session"] });
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Authentication failed");
    },
  });

  if (sessionQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Checking Session</CardTitle>
            <CardDescription>Verifying access to the Uni-Backups control plane.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (sessionQuery.data?.authenticated) {
    return <>{children}</>;
  }

  const configurationError =
    sessionQuery.error instanceof Error ? sessionQuery.error.message : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <LockKeyhole className="h-5 w-5" />
            Administrator Sign-In
          </CardTitle>
          <CardDescription>
            Enter the API token configured for this deployment to unlock backup operations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {configurationError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <div className="mb-1 flex items-center gap-2 font-medium">
                <ShieldAlert className="h-4 w-4" />
                Authentication Setup Error
              </div>
              <p>{configurationError}</p>
            </div>
          )}

          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (!token.trim()) {
                setErrorMessage("Token is required");
                return;
              }

              loginMutation.mutate(token.trim());
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="api-token">API Token</Label>
              <Input
                id="api-token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                autoComplete="current-password"
                placeholder="Enter deployment API token"
              />
            </div>

            {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}

            <Button className="w-full" type="submit" disabled={loginMutation.isPending}>
              {loginMutation.isPending ? "Signing In..." : "Sign In"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
