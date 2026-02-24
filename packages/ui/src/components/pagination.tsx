import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  className?: string;
}

const Pagination = React.forwardRef<HTMLDivElement, PaginationProps>(
  (
    {
      page,
      pageSize,
      total,
      totalPages,
      onPageChange,
      onPageSizeChange,
      pageSizeOptions = [10, 25, 50, 100],
      className,
    },
    ref
  ) => {
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);
    const canGoPrevious = page > 1;
    const canGoNext = page < totalPages;

    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col sm:flex-row items-center justify-between gap-4 py-4",
          className
        )}
      >
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {total > 0 ? (
            <>
              Showing <span className="font-medium text-foreground">{start}</span>
              {" - "}
              <span className="font-medium text-foreground">{end}</span>
              {" of "}
              <span className="font-medium text-foreground">{total}</span>
              {" items"}
            </>
          ) : (
            "No items"
          )}
        </div>

        <div className="flex items-center gap-4">
          {onPageSizeChange && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Rows per page</span>
              <Select
                value={pageSize.toString()}
                onValueChange={(value) => onPageSizeChange(parseInt(value, 10))}
              >
                <SelectTrigger className="h-8 w-[70px]">
                  <SelectValue placeholder={pageSize.toString()} />
                </SelectTrigger>
                <SelectContent side="top">
                  {pageSizeOptions.map((size) => (
                    <SelectItem key={size} value={size.toString()}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(page - 1)}
              disabled={!canGoPrevious}
              aria-label="Go to previous page"
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only sm:ml-1">Previous</span>
            </Button>

            <div className="flex items-center gap-1 px-2">
              <span className="text-sm text-muted-foreground">Page</span>
              <span className="text-sm font-medium">{page}</span>
              <span className="text-sm text-muted-foreground">of</span>
              <span className="text-sm font-medium">{totalPages || 1}</span>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(page + 1)}
              disabled={!canGoNext}
              aria-label="Go to next page"
            >
              <span className="sr-only sm:not-sr-only sm:mr-1">Next</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }
);
Pagination.displayName = "Pagination";

export { Pagination };
