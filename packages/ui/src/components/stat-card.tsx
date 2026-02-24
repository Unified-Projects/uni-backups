import * as React from "react";
import { cn } from "../lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "./card";
import type { LucideIcon } from "lucide-react";

export interface StatCardProps {
  title: string;
  value: string | number;
  icon?: LucideIcon;
  iconColor?: string;
  iconBgColor?: string;
  description?: string;
  trend?: {
    value: number;
    direction: "up" | "down";
  };
  className?: string;
}

const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  (
    {
      title,
      value,
      icon: Icon,
      iconColor = "text-primary",
      iconBgColor = "bg-muted",
      description,
      trend,
      className,
    },
    ref
  ) => {
    return (
      <Card
        ref={ref}
        className={cn(
          "transition-all duration-200 hover:shadow-md hover:border-primary/20",
          className
        )}
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {Icon && (
            <div className={cn("rounded-full p-2", iconBgColor, iconColor)}>
              <Icon className="h-4 w-4" />
            </div>
          )}
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-2">
            <div className="text-2xl font-bold">{value}</div>
            {trend && (
              <span
                className={cn(
                  "text-xs font-medium",
                  trend.direction === "up"
                    ? "text-green-500"
                    : "text-red-500"
                )}
              >
                {trend.direction === "up" ? "+" : "-"}
                {Math.abs(trend.value)}%
              </span>
            )}
          </div>
          {description && (
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          )}
        </CardContent>
      </Card>
    );
  }
);
StatCard.displayName = "StatCard";

export { StatCard };
