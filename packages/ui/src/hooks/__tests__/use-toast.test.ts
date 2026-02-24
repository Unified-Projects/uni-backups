import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Reset module state between tests
beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toast function", () => {
  it("creates a toast with unique ID", async () => {
    const { toast } = await import("../use-toast");

    const result = toast({ title: "Test Toast" });

    expect(result.id).toBeDefined();
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
  });

  it("returns dismiss function", async () => {
    const { toast } = await import("../use-toast");

    const result = toast({ title: "Test Toast" });

    expect(result.dismiss).toBeDefined();
    expect(typeof result.dismiss).toBe("function");
  });

  it("returns update function", async () => {
    const { toast } = await import("../use-toast");

    const result = toast({ title: "Test Toast" });

    expect(result.update).toBeDefined();
    expect(typeof result.update).toBe("function");
  });

  it("creates toasts with different IDs", async () => {
    const { toast } = await import("../use-toast");

    const toast1 = toast({ title: "Toast 1" });
    const toast2 = toast({ title: "Toast 2" });

    expect(toast1.id).not.toBe(toast2.id);
  });
});

describe("useToast hook", () => {
  it("returns initial empty state", async () => {
    vi.resetModules();
    const { useToast } = await import("../use-toast");

    const { result } = renderHook(() => useToast());

    expect(result.current.toasts).toEqual([]);
  });

  it("returns toast function", async () => {
    const { useToast } = await import("../use-toast");

    const { result } = renderHook(() => useToast());

    expect(result.current.toast).toBeDefined();
    expect(typeof result.current.toast).toBe("function");
  });

  it("returns dismiss function", async () => {
    const { useToast } = await import("../use-toast");

    const { result } = renderHook(() => useToast());

    expect(result.current.dismiss).toBeDefined();
    expect(typeof result.current.dismiss).toBe("function");
  });

  it("updates state when toast is added", async () => {
    vi.resetModules();
    const { useToast } = await import("../use-toast");

    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "New Toast" });
    });

    expect(result.current.toasts.length).toBe(1);
    expect(result.current.toasts[0].title).toBe("New Toast");
  });

  it("toast has open property set to true", async () => {
    vi.resetModules();
    const { useToast } = await import("../use-toast");

    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "Open Toast" });
    });

    expect(result.current.toasts[0].open).toBe(true);
  });

  it("limits toasts to TOAST_LIMIT (1)", async () => {
    vi.resetModules();
    const { useToast } = await import("../use-toast");

    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "Toast 1" });
      result.current.toast({ title: "Toast 2" });
      result.current.toast({ title: "Toast 3" });
    });

    // TOAST_LIMIT is 1, so only the most recent toast should be visible
    expect(result.current.toasts.length).toBe(1);
    expect(result.current.toasts[0].title).toBe("Toast 3");
  });

  it("dismiss sets toast open to false", async () => {
    vi.resetModules();
    const { useToast } = await import("../use-toast");

    const { result } = renderHook(() => useToast());

    let toastId: string;
    act(() => {
      const t = result.current.toast({ title: "Dismissable Toast" });
      toastId = t.id;
    });

    expect(result.current.toasts[0].open).toBe(true);

    act(() => {
      result.current.dismiss(toastId!);
    });

    expect(result.current.toasts[0].open).toBe(false);
  });

  it("dismiss without ID dismisses all toasts", async () => {
    vi.resetModules();
    const { useToast } = await import("../use-toast");

    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "Toast 1" });
    });

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.toasts[0].open).toBe(false);
  });
});

describe("toast reducer actions", () => {
  it("UPDATE_TOAST updates toast properties", async () => {
    vi.resetModules();
    const { useToast } = await import("../use-toast");

    const { result } = renderHook(() => useToast());

    let toastResult: { id: string; update: (props: any) => void };
    act(() => {
      toastResult = result.current.toast({ title: "Original Title" });
    });

    expect(result.current.toasts[0].title).toBe("Original Title");

    act(() => {
      toastResult!.update({ title: "Updated Title", id: toastResult!.id });
    });

    expect(result.current.toasts[0].title).toBe("Updated Title");
  });

  it("toast preserves description property", async () => {
    vi.resetModules();
    const { useToast } = await import("../use-toast");

    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({
        title: "Title",
        description: "This is a description",
      });
    });

    expect(result.current.toasts[0].description).toBe("This is a description");
  });

  it("toast preserves variant property", async () => {
    vi.resetModules();
    const { useToast } = await import("../use-toast");

    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({
        title: "Error",
        variant: "destructive",
      });
    });

    expect(result.current.toasts[0].variant).toBe("destructive");
  });
});

describe("multiple listeners", () => {
  it("multiple hooks receive state updates", async () => {
    vi.resetModules();
    const { useToast, toast } = await import("../use-toast");

    const { result: result1 } = renderHook(() => useToast());
    const { result: result2 } = renderHook(() => useToast());

    act(() => {
      toast({ title: "Shared Toast" });
    });

    expect(result1.current.toasts.length).toBe(1);
    expect(result2.current.toasts.length).toBe(1);
    expect(result1.current.toasts[0].title).toBe("Shared Toast");
    expect(result2.current.toasts[0].title).toBe("Shared Toast");
  });

  it("listener cleanup on unmount", async () => {
    vi.resetModules();
    const { useToast, toast } = await import("../use-toast");

    const { result, unmount } = renderHook(() => useToast());

    act(() => {
      toast({ title: "Before Unmount" });
    });

    expect(result.current.toasts.length).toBe(1);

    unmount();

    // After unmount, adding a toast should not throw
    expect(() => {
      act(() => {
        toast({ title: "After Unmount" });
      });
    }).not.toThrow();
  });
});

describe("onOpenChange callback", () => {
  it("toast has onOpenChange callback", async () => {
    vi.resetModules();
    const { useToast } = await import("../use-toast");

    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "Callback Toast" });
    });

    expect(result.current.toasts[0].onOpenChange).toBeDefined();
    expect(typeof result.current.toasts[0].onOpenChange).toBe("function");
  });

  it("onOpenChange(false) dismisses the toast", async () => {
    vi.resetModules();
    const { useToast } = await import("../use-toast");

    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "Dismissable" });
    });

    expect(result.current.toasts[0].open).toBe(true);

    act(() => {
      result.current.toasts[0].onOpenChange?.(false);
    });

    expect(result.current.toasts[0].open).toBe(false);
  });
});
