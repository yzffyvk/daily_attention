import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AttentionAtmosphere } from "@/features/profile/attention-atmosphere";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function setupMotion(reduced = false, fine = true) {
  const preferences = new Map<string, MediaQueryList>();
  vi.stubGlobal("matchMedia", vi.fn((query: string) => {
    const media = Object.assign(new EventTarget(), {
      matches: query.includes("reduced-motion") ? reduced : fine,
      media: query,
    }) as MediaQueryList;
    preferences.set(query, media);
    return media;
  }));
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => {
    frames.set(++next, callback); return next;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
  const view = render(<AttentionAtmosphere />);
  const move = () => act(() => {
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 300, clientY: 180 }));
    for (const [id, frame] of frames) { frames.delete(id); frame(16); }
  });
  return { ...view, move, frames, preferences };
}

describe("decorative pointer motion", () => {
  it("tracks a fine pointer without replacing or intercepting the native cursor", () => {
    const { move } = setupMotion();
    move();
    const cursor = screen.getByTestId("attention-pointer");
    expect(cursor).toHaveAttribute("data-visible", "true");
    expect(cursor.style.transform).toContain("300px, 180px");
    expect(cursor).toHaveAttribute("aria-hidden", "true");
  });

  it.each([[true, true], [false, false]])("stays static with reduced motion %s and fine pointer %s", (reduced, fine) => {
    const { move, frames } = setupMotion(reduced, fine);
    move();
    expect(screen.getByTestId("attention-pointer")).not.toHaveAttribute("data-visible", "true");
    expect(frames.size).toBe(0);
    expect(screen.getByTestId("attention-atmosphere")).toHaveAttribute("data-motion", "off");
  });

  it("stops immediately when reduced motion is enabled, and cleans up pending frames on unmount", () => {
    const { move, preferences, frames, unmount } = setupMotion();
    move();
    const media = preferences.get("(prefers-reduced-motion: reduce)")!;
    act(() => {
      Object.assign(media, { matches: true });
      media.dispatchEvent(new Event("change"));
    });
    expect(screen.getByTestId("attention-pointer")).toHaveAttribute("data-visible", "false");
    expect(screen.getByTestId("attention-atmosphere")).toHaveAttribute("data-motion", "off");
    unmount();
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: 40 }));
    expect(frames.size).toBe(0);
  });
});
