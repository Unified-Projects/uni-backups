import * as React from "react";
import { cn } from "../lib/utils";

export interface PageHeaderProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

const PageHeader = React.forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ title, description, action, className }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between",
          className
        )}
      >
        <div>
          <h1 className="text-3xl font-bold">{title}</h1>
          {description && (
            <p className="text-muted-foreground">{description}</p>
          )}
        </div>
        {action && <div className="mt-2 sm:mt-0">{action}</div>}
      </div>
    );
  }
);
PageHeader.displayName = "PageHeader";

export { PageHeader };
