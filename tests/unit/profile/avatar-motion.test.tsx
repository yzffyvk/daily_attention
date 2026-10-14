import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AvatarImage } from "@/features/profile/avatar-image";
import { setColorTheme } from "@/features/theme/theme";

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.theme;
  localStorage.clear();
});

it("falls back to the original portrait after an animation load error and can animate a different persona", () => {
  const onError = vi.fn();
  const view = render(<AvatarImage avatarKey={1} animated onError={onError} />);
  const portrait = view.container.querySelector("img")!;
  expect(view.container.querySelector("source")).not.toBeNull();
  fireEvent.error(portrait);
  expect(view.container.querySelector("source")).toBeNull();
  expect(portrait).toHaveAttribute("src", "/avatars/aura-dreamer.png");
  expect(onError).toHaveBeenCalledOnce();

  view.rerender(<AvatarImage avatarKey={2} animated />);
  expect(view.container.querySelector("source")).toHaveAttribute("srcset", "/avatars/motion/aura-scholar.webp");
  expect(portrait).toHaveAttribute("src", "/avatars/aura-scholar.png");
});

it("uses the light animation after a failed dark animation without changing persona", () => {
  const view = render(<AvatarImage avatarKey={3} animated />);
  fireEvent.error(view.container.querySelector("img")!);
  expect(view.container.querySelector("source")).toBeNull();
  act(() => setColorTheme("light"));
  expect(view.container.querySelector("source")).toHaveAttribute("srcset", "/avatars/motion/aura-technophile-light.webp");
  expect(view.container.querySelector("img")).toHaveAttribute("src", "/avatars/aura-technophile-light.png");
});

it("does not request an animation for a static account portrait", () => {
  const view = render(<AvatarImage avatarKey={5} />);
  expect(view.container.querySelector("source")).toBeNull();
  expect(view.container.querySelector("img")).toHaveAttribute("src", "/avatars/aura-doer.png");
});
