import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckInWorkspace } from "@/features/checkins/checkin-workspace";
import {
  formatCalendarDate,
  formatMonth,
  formatDate,
  getTodayKey,
  monthKeyForDate,
  shiftMonth,
} from "@/features/checkins/dates";
import type { CheckInRecord } from "@/features/checkins/types";
import { TestQueryProvider } from "@/tests/helpers/test-query-provider";

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function record(date: string, attention: string, version = 1): CheckInRecord {
  return {
    id: `record-${date}`,
    date,
    attention,
    sourceUrl: "",
    summary: "",
    inspiration: "",
    imagePath: null,
    imageName: "",
    imageUrl: null,
    version,
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
  };
}

function missingCheckIn() {
  return response(
    {
      ok: false,
      error: { code: "NOT_FOUND", message: "这一天还没有打卡记录" },
      requestId: "date-request",
    },
    404,
  );
}

function renderWorkspace(initialDate: string) {
  return render(
    <TestQueryProvider>
      <CheckInWorkspace initialDate={initialDate} />
    </TestQueryProvider>,
  );
}

function field<T extends HTMLInputElement | HTMLTextAreaElement>(id: string) {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    throw new Error(`Expected editor field ${id}`);
  }
  return element as T;
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CheckInWorkspace", () => {
  it("opens the unsaved switch dialog before changing dates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return response({ ok: true, data: [], requestId: "month-request" });
        }
        return response(
          {
            ok: false,
            error: { code: "NOT_FOUND", message: "这一天还没有打卡记录" },
            requestId: "date-request",
          },
          404,
        );
      }),
    );

    render(
      <TestQueryProvider>
        <CheckInWorkspace initialDate="2026-07-23" />
      </TestQueryProvider>,
    );

    await userEvent.type(screen.getByLabelText("attention"), "今天学习了 RAG");
    await userEvent.click(screen.getByRole("button", { name: /7月24日/ }));

    expect(screen.getByRole("dialog", { name: "尚未保存" })).toBeVisible();
    expect(screen.getByRole("button", { name: "保存并切换" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "放弃修改" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeEnabled();
  });

  it("freezes editor, image, and date controls until a deferred save settles", async () => {
    const save = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
        }
        if (init?.method === "PUT") return save.promise;
        return Promise.resolve(missingCheckIn());
      }),
    );

    const { container } = renderWorkspace("2026-07-23");
    const user = userEvent.setup();
    const attention = screen.getByLabelText("attention");
    const sourceUrl = field<HTMLInputElement>("source-url");
    const summary = field<HTMLTextAreaElement>("summary");
    const inspiration = field<HTMLTextAreaElement>("inspiration");

    await user.type(attention, "先保存这一版");
    await user.click(screen.getByRole("button", { name: /完成打卡/ }));

    await waitFor(() => expect(attention).toBeDisabled());
    expect(sourceUrl).toBeDisabled();
    expect(summary).toBeDisabled();
    expect(inspiration).toBeDisabled();
    expect(screen.getByLabelText("添加图片笔记")).toBeDisabled();
    expect(screen.getByRole("button", { name: /7月24日/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /今日/ })).toBeDisabled();
    expect(container.querySelector(".checkin-form")).toHaveAttribute("aria-busy", "true");

    await user.type(attention, "不应写入的新内容");
    expect(attention).toHaveValue("先保存这一版");

    save.resolve(
      response({
        ok: true,
        data: record("2026-07-23", "先保存这一版"),
        requestId: "save-request",
      }),
    );

    await waitFor(() => expect(attention).toBeEnabled());
    expect(attention).toHaveValue("先保存这一版");
    expect(container.querySelector(".checkin-form")).toHaveAttribute("aria-busy", "false");
  });

  it("keeps the selected date and displayed month when a cross-month switch is cancelled", async () => {
    const today = getTodayKey();
    const todayMonth = monthKeyForDate(today);
    const initialMonth = shiftMonth(todayMonth, -1);
    const initialDate = `${initialMonth}-15`;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    renderWorkspace(initialDate);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("attention"), "还没保存的内容");
    await user.click(screen.getByRole("button", { name: /今日/ }));

    expect(screen.getByRole("dialog", { name: "尚未保存" })).toBeVisible();
    expect(screen.getByRole("heading", { name: formatMonth(initialMonth) })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("dialog", { name: "尚未保存" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: formatMonth(initialMonth) })).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: new RegExp(`${formatCalendarDate(initialDate)}.*当前选中`),
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("switches to the target month only after saving a dirty cross-month entry", async () => {
    const today = getTodayKey();
    const todayMonth = monthKeyForDate(today);
    const initialDate = `${shiftMonth(todayMonth, -1)}-15`;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
        }
        if (init?.method === "PUT") {
          return Promise.resolve(
            response({ ok: true, data: record(initialDate, "保存后切换"), requestId: "save-request" }),
          );
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    renderWorkspace(initialDate);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("attention"), "保存后切换");
    await user.click(screen.getByRole("button", { name: /今日/ }));
    await user.click(screen.getByRole("button", { name: "保存并切换" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: formatMonth(todayMonth) })).toBeVisible();
      expect(screen.getByRole("heading", { name: formatDate(today) })).toBeVisible();
    });
  });

  it("switches to the target month after discarding a dirty cross-month entry", async () => {
    const today = getTodayKey();
    const todayMonth = monthKeyForDate(today);
    const initialDate = `${shiftMonth(todayMonth, -1)}-15`;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.includes("/api/checkins?month=")) {
        return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
      }
      if (init?.method === "PUT") {
        return Promise.resolve(response({ ok: true, data: record(initialDate, "不该保存"), requestId: "save-request" }));
      }
      return Promise.resolve(missingCheckIn());
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWorkspace(initialDate);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("attention"), "放弃后切换");
    await user.click(screen.getByRole("button", { name: /今日/ }));
    await user.click(screen.getByRole("button", { name: "放弃修改" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: formatMonth(todayMonth) })).toBeVisible());
    expect(screen.getByLabelText("attention")).toHaveValue("");
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT")).toBe(false);
  });

  it("keeps focus inside an unsaved dialog when saving is unavailable and restores the trigger on Escape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    renderWorkspace("2026-07-23");
    const user = userEvent.setup();
    await user.type(field<HTMLInputElement>("source-url"), "https://example.com");
    const target = screen.getByRole("button", { name: /7月24日/ });
    await user.click(target);

    const dialog = screen.getByRole("dialog", { name: "尚未保存" });
    const save = screen.getByRole("button", { name: "保存并切换" });
    const discard = screen.getByRole("button", { name: "放弃修改" });
    expect(save).toBeDisabled();
    await waitFor(() => expect(discard).toHaveFocus());

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "尚未保存" })).not.toBeInTheDocument();
    expect(target).toHaveFocus();
    expect(dialog).not.toBeInTheDocument();
  });

  it("suspends the dirty dialog for a version conflict and retries with the cloud version", async () => {
    const date = "2026-07-23";
    const cloud = record(date, "云端的新版本", 2);
    const saved = record(date, "云端初版，本地补充", 3);
    const saveBodies: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
        }
        if (init?.method === "PUT") {
          saveBodies.push(JSON.parse(String(init.body)));
          if (saveBodies.length === 1) {
            return Promise.resolve(
              response(
                {
                  ok: false,
                  error: {
                    code: "VERSION_CONFLICT",
                    message: "云端记录已更新，请确认后重试",
                    details: { current: cloud },
                  },
                  requestId: "conflict-request",
                },
                409,
              ),
            );
          }
          return Promise.resolve(response({ ok: true, data: saved, requestId: "retry-request" }));
        }
        if (path.endsWith(`/${date}`)) {
          return Promise.resolve(response({ ok: true, data: record(date, "云端初版"), requestId: "date-request" }));
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    renderWorkspace(date);
    const user = userEvent.setup();
    const attention = screen.getByLabelText("attention");
    await waitFor(() => expect(attention).toHaveValue("云端初版"));
    await user.type(attention, "，本地补充");
    const targetButton = screen.getByRole("button", { name: /7月24日/ });
    await user.click(targetButton);
    await user.click(screen.getByRole("button", { name: "保存并切换" }));

    const conflict = await screen.findByRole("dialog", { name: "云端记录已更新" });
    expect(screen.queryByRole("dialog", { name: "尚未保存" })).not.toBeInTheDocument();
    const keepLocal = screen.getByRole("button", { name: "保留本地内容" });
    const loadCloud = screen.getByRole("button", { name: "载入云端版本" });
    await waitFor(() => expect(keepLocal).toHaveFocus());
    await user.tab({ shift: true });
    expect(loadCloud).toHaveFocus();
    await user.tab();
    expect(keepLocal).toHaveFocus();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "云端记录已更新" })).not.toBeInTheDocument());
    expect(targetButton).toHaveFocus();
    expect(conflict).not.toBeInTheDocument();
    expect(attention).toHaveValue("云端初版，本地补充");

    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(saveBodies).toHaveLength(2));
    expect(saveBodies[1]).toMatchObject({ version: 2, attention: "云端初版，本地补充" });
    await waitFor(() => expect(attention).toHaveValue("云端初版，本地补充"));
  });
});
