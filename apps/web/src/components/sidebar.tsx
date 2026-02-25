"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import {
  LayoutDashboard,
  Server,
  FolderArchive,
  Database,
  RotateCcw,
  Clock,
  Sun,
  Moon,
  Users,
} from "lucide-react";
import { cn } from "@uni-backups/ui/lib/utils";
import { Button } from "@uni-backups/ui/components/button";

const navigation = [
  { name: "Dashboard", href: "/", icon: LayoutDashboard },
  { name: "Jobs", href: "/jobs", icon: FolderArchive },
  { name: "Snapshots", href: "/snapshots", icon: Database },
  { name: "Backup Servers", href: "/storage", icon: Server },
  { name: "Workers", href: "/workers", icon: Users },
  { name: "Restore", href: "/restore", icon: RotateCcw },
  { name: "Schedule", href: "/schedule", icon: Clock },
];

export function Sidebar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex h-full w-16 md:w-64 flex-col border-r bg-card">
      <div className="flex h-16 items-center border-b px-2 md:px-6 md:gap-3">
        <Image src="/icon.svg" alt="Uni-Backups" width={32} height={32} className="shrink-0" />
        <span className="hidden md:block text-lg font-semibold">Uni-Backups</span>
      </div>

      <nav className="flex-1 space-y-1 px-1 md:px-3 py-4">
        {navigation.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/" && pathname.startsWith(item.href));

          return (
            <a
              key={item.name}
              href={item.href}
              className={cn(
                "flex items-center rounded-lg px-2 md:px-3 py-2 text-sm font-medium transition-colors md:gap-3",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              <span className="hidden md:block">{item.name}</span>
            </a>
          );
        })}
      </nav>

      <div className="border-t p-2 md:p-4">
        <div className="flex items-center justify-between">
          <div className="hidden md:block text-xs text-muted-foreground">
            Uni-Backups v0.1.1
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">Toggle theme</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
