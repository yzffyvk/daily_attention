import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuthCard } from "@/features/auth/auth-card";
import { AvatarSelector } from "@/features/profile/avatar-selector";

function setup() {
  return render(<AuthCard step="02" title="选择学习形象" description="测试主题">
    <AvatarSelector name="avatar" value={2} onChange={vi.fn()} />
  </AuthCard>);
}

beforeEach(() => { localStorage.clear(); document.documentElement.dataset.theme = "dark"; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); delete document.documentElement.dataset.theme; });

it("switches the whole page and selected avatar while retaining its numeric identity", async () => {
  const view = setup();
  const user = userEvent.setup();
  expect(view.container.querySelector('img[src="/avatars/aura-scholar.png"]')).not.toBeNull();
  await user.click(screen.getByRole("button", { name: "切换为浅色" }));
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(localStorage.getItem("aura-color-theme")).toBe("light");
  expect(screen.getByRole("radio", { name: "学者" })).toBeChecked();
  expect(view.container.querySelector('img[src="/avatars/aura-scholar-light.png"]')).not.toBeNull();
  await user.click(screen.getByRole("button", { name: "切换为深色" }));
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem("aura-color-theme")).toBe("dark");
});

it("keeps the chosen theme after the auth screen remounts", async () => {
  const view = setup();
  await userEvent.setup().click(screen.getByRole("button", { name: "切换为浅色" }));
  view.unmount();
  setup();
  expect(screen.getByRole("button", { name: "切换为深色" })).toBeVisible();
});

it("still switches when browser storage is unavailable", async () => {
  setup();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("blocked"); });
  await userEvent.setup().click(screen.getByRole("button", { name: "切换为浅色" }));
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(screen.getByRole("button", { name: "切换为深色" })).toBeVisible();
});

it("synchronizes another tab's valid choice and treats an invalid value as dark", () => {
  setup();
  act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "aura-color-theme", newValue: "light" })); });
  expect(screen.getByRole("button", { name: "切换为深色" })).toBeVisible();
  act(() => { window.dispatchEvent(new StorageEvent("storage", { key: "aura-color-theme", newValue: "unexpected" })); });
  expect(screen.getByRole("button", { name: "切换为浅色" })).toBeVisible();
});
