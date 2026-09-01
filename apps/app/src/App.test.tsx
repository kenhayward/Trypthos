import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";
import { APP_VERSION } from "./lib/appInfo";

describe("App", () => {
  it("renders all three panels", () => {
    render(<App />);
    expect(screen.getByRole("complementary", { name: "Workspace" })).toBeDefined();
    expect(screen.getByRole("main", { name: "Editor" })).toBeDefined();
    expect(screen.getByRole("complementary", { name: "Chat" })).toBeDefined();
  });

  it("shows the build version, which comes from /version.json", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: `About ${APP_VERSION}` })).toBeDefined();
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("opens and closes the About box", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByRole("dialog")).toBeNull();

    // Resolve the element first, then act on it. Awaiting a query inside an act scope is what
    // provokes React's "not configured to support act" warning, which test-setup turns into a failure.
    await user.click(screen.getByRole("button", { name: `About ${APP_VERSION}` }));
    expect(screen.getByRole("dialog")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
