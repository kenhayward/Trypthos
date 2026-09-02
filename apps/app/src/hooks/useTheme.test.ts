import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useTheme } from "./useTheme";

const stamped = () => document.documentElement.getAttribute("data-theme");

afterEach(() => document.documentElement.removeAttribute("data-theme"));

describe("useTheme", () => {
  it("stamps an explicit choice", () => {
    renderHook(() => useTheme("dark"));
    expect(stamped()).toBe("dark");

    renderHook(() => useTheme("light"));
    expect(stamped()).toBe("light");
  });

  // Nothing is stamped for "system", deliberately. The stylesheet's media query then answers, so the
  // theme keeps following the OS while the app is open - stamping a resolved value would freeze it
  // at whatever it was on launch.
  it("stamps nothing when following the system", () => {
    renderHook(() => useTheme("system"));
    expect(stamped()).toBeNull();
  });

  it("removes the stamp when returning to system", () => {
    const { rerender } = renderHook(({ theme }) => useTheme(theme), {
      initialProps: { theme: "dark" as const },
    });
    expect(stamped()).toBe("dark");

    rerender({ theme: "system" as never });
    expect(stamped()).toBeNull();
  });
});
