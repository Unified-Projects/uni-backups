import Link from "next/link";
import { Button } from "@uni-backups/ui/components/button";

export default function NotFound() {
  return (
    <div
      data-testid="not-found"
      className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center"
    >
      <p className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
        Error 404
      </p>
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">Page Not Found</h1>
        <p className="max-w-xl text-sm text-muted-foreground">
          The page you requested does not exist or may have moved.
        </p>
      </div>
      <Button asChild>
        <Link href="/">Return to Dashboard</Link>
      </Button>
    </div>
  );
}
