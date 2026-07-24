import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckInWorkspace } from "@/features/checkins/checkin-workspace";
import { deleteCheckInImage, uploadCheckInImage } from "@/features/checkins/api";
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
vi.mock("@/features/checkins/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/checkins/api")>();
  return {
    ...actual,
    deleteCheckInImage: vi.fn(),
    uploadCheckInImage: vi.fn(),
  };
});
vi.mock("@/features/checkins/image-note-uploader", () => ({
  ImageNoteUploader: ({
    disabled = false,
    file,
    onChange,
    removeImage,
  }: {
    disabled?: boolean;
    file: File | null;
    onChange: (selection: { file: File | null; removeImage: boolean }) => void | Promise<void>;
    removeImage: boolean;
  }) => (
    <div>
      <input aria-label="添加图片笔记" disabled={disabled} type="file" />
      <button
        disabled={disabled}
        onClick={() => void onChange({
          file: new File(["replacement"], "replacement.png", { type: "image/png" }),
          removeImage: false,
        })}
        type="button"
      >
        替换测试图片
      </button>
      <button
        disabled={disabled}
        onClick={() => void onChange({ file: null, removeImage: true })}
        type="button"
      >
        测试移除图片
      </button>
      <output aria-label="图片草稿状态">{file?.name ?? "none"}:{String(removeImage)}</output>
    </div>
  ),
}));

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

function recordWithImage(date: string, attention: string, version = 1): CheckInRecord {
  return {
    ...record(date, attention, version),
    imagePath: `checkin-images/user/${date}/existing.png`,
    imageName: "existing.png",
    imageUrl: "https://example.com/existing.png",
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

async function waitForEditorReady() {
  await waitFor(() => expect(screen.getByLabelText("attention")).toBeEnabled());
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
  vi.mocked(deleteCheckInImage).mockReset();
  vi.mocked(uploadCheckInImage).mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CheckInWorkspace", () => {
  it("locks date, editor, save, and image actions until the selected record hydrates", async () => {
    const date = "2026-07-23";
    const selected = deferred<Response>();
    const cloudRecord = {
      ...record(date, "云端 attention"),
      sourceUrl: "https://example.com/cloud-source",
      summary: "云端小结",
      inspiration: "云端灵感",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
        }
        if (path.endsWith(`/${date}`)) return selected.promise;
        return Promise.resolve(missingCheckIn());
      }),
    );

    renderWorkspace(date);

    const attention = screen.getByLabelText("attention");
    expect(attention).toBeDisabled();
    expect(field<HTMLInputElement>("source-url")).toBeDisabled();
    expect(field<HTMLTextAreaElement>("summary")).toBeDisabled();
    expect(field<HTMLTextAreaElement>("inspiration")).toBeDisabled();
    expect(screen.getByLabelText("添加图片笔记")).toBeDisabled();
    expect(screen.getByRole("button", { name: /完成打卡/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /今日/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /7月24日/ })).toBeDisabled();

    selected.resolve(response({ ok: true, data: cloudRecord, requestId: "date-request" }));

    await waitFor(() => expect(attention).toBeEnabled());
    expect(attention).toHaveValue("云端 attention");
    expect(field<HTMLInputElement>("source-url")).toHaveValue("https://example.com/cloud-source");
    expect(field<HTMLTextAreaElement>("summary")).toHaveValue("云端小结");
    expect(field<HTMLTextAreaElement>("inspiration")).toHaveValue("云端灵感");
  });

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

    await waitForEditorReady();
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

    await waitForEditorReady();
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
    await waitForEditorReady();
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

  it("does not navigate for a pending Today action and leaves the view unchanged on cancel", async () => {
    const today = getTodayKey();
    const initialMonth = shiftMonth(monthKeyForDate(today), -1);
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
    await waitForEditorReady();
    await user.type(screen.getByLabelText("attention"), "等待确认的 Today 切换");
    await user.click(screen.getByRole("button", { name: /今日/ }));

    expect(screen.getByRole("dialog", { name: "尚未保存" })).toBeVisible();
    expect(screen.getByRole("heading", { name: formatMonth(initialMonth) })).toBeVisible();
    expect(screen.getByRole("heading", { name: formatDate(initialDate) })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.getByRole("heading", { name: formatMonth(initialMonth) })).toBeVisible();
    expect(screen.getByRole("heading", { name: formatDate(initialDate) })).toBeVisible();
  });

  it("preserves an intentionally browsed month when a dirty date selection is cancelled", async () => {
    const initialMonth = "2026-06";
    const initialDate = `${initialMonth}-15`;
    const browsedMonth = shiftMonth(initialMonth, 1);
    const targetDate = `${browsedMonth}-10`;
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
    await waitForEditorReady();
    await user.type(screen.getByLabelText("attention"), "浏览后仍未保存");
    await user.click(screen.getByRole("button", { name: "下个月" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: formatMonth(browsedMonth) })).toBeVisible());
    await user.click(screen.getByRole("button", { name: new RegExp(formatCalendarDate(targetDate)) }));

    expect(screen.getByRole("dialog", { name: "尚未保存" })).toBeVisible();
    expect(screen.getByRole("heading", { name: formatMonth(browsedMonth) })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.getByRole("heading", { name: formatMonth(browsedMonth) })).toBeVisible();
    expect(screen.getByRole("heading", { name: formatDate(initialDate) })).toBeVisible();
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
    await waitForEditorReady();
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
    await waitForEditorReady();
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
    await waitForEditorReady();
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

  it("cycles Tab and Shift+Tab through every unsaved dialog action", async () => {
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
    await waitForEditorReady();
    await user.type(screen.getByLabelText("attention"), "待保存内容");
    await user.click(screen.getByRole("button", { name: /7月24日/ }));

    const save = screen.getByRole("button", { name: "保存并切换" });
    const discard = screen.getByRole("button", { name: "放弃修改" });
    const cancel = screen.getByRole("button", { name: "取消" });
    const close = screen.getByRole("button", { name: "关闭" });
    await waitFor(() => expect(save).toHaveFocus());

    await user.tab();
    expect(discard).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab();
    expect(save).toHaveFocus();

    await user.tab({ shift: true });
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(cancel).toHaveFocus();
  });

  it("keeps a later image removal when an earlier replacement cleanup resolves late", async () => {
    const date = "2026-07-23";
    const cloudRecord = recordWithImage(date, "云端初版");
    const cleanup = deferred<void>();
    vi.mocked(uploadCheckInImage).mockResolvedValue("checkin-images/user/pending.png");
    vi.mocked(deleteCheckInImage)
      .mockReturnValueOnce(cleanup.promise)
      .mockResolvedValue(undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
        }
        if (init?.method === "PUT") {
          return Promise.resolve(response({
            ok: false,
            error: {
              code: "VERSION_CONFLICT",
              message: "云端记录已更新，请确认后重试",
              details: { current: cloudRecord },
            },
            requestId: "conflict-request",
          }, 409));
        }
        if (path.endsWith(`/${date}`)) {
          return Promise.resolve(response({ ok: true, data: cloudRecord, requestId: "date-request" }));
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    renderWorkspace(date);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByLabelText("attention")).toHaveValue("云端初版"));
    await user.click(screen.getByRole("button", { name: "替换测试图片" }));
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await user.click(await screen.findByRole("button", { name: "保留本地内容" }));

    await user.click(screen.getByRole("button", { name: "替换测试图片" }));
    await waitFor(() => expect(deleteCheckInImage).toHaveBeenCalledWith("checkin-images/user/pending.png"));
    await user.click(screen.getByRole("button", { name: "测试移除图片" }));

    await waitFor(() => expect(screen.getByLabelText("图片草稿状态")).toHaveTextContent("none:true"));
    cleanup.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(screen.getByLabelText("图片草稿状态")).toHaveTextContent("none:true");
  });

  it("closes the profile dialog and keeps only the conflict dialog during a save conflict", async () => {
    const date = "2026-07-23";
    const initial = record(date, "云端初版");
    const cloud = record(date, "云端新版本", 2);
    const save = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
        }
        if (init?.method === "PUT") {
          return save.promise;
        }
        if (path.endsWith(`/${date}`)) {
          return Promise.resolve(response({ ok: true, data: initial, requestId: "date-request" }));
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    render(
      <TestQueryProvider>
        <CheckInWorkspace
          initialDate={date}
          initialProfile={{ id: "profile-1", avatarKey: 1, displayName: "学习者" }}
        />
      </TestQueryProvider>,
    );
    const user = userEvent.setup();
    const attention = screen.getByLabelText("attention");
    await waitFor(() => expect(attention).toHaveValue("云端初版"));
    await user.type(attention, "，本地补充");
    await user.click(screen.getByRole("button", { name: "打开账户菜单" }));
    await user.click(screen.getByRole("menuitem", { name: "编辑资料" }));
    expect(screen.getByRole("dialog", { name: "编辑资料" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "编辑资料" })).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "打开账户菜单" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /今日/ })).toBeDisabled();
    save.resolve(
      response({
        ok: false,
        error: {
          code: "VERSION_CONFLICT",
          message: "云端记录已更新，请确认后重试",
          details: { current: cloud },
        },
        requestId: "conflict-request",
      }, 409),
    );

    const conflict = await screen.findByRole("dialog", { name: "云端记录已更新" });
    expect(screen.queryByRole("dialog", { name: "编辑资料" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("dialog")).toEqual([conflict]);
    expect(screen.getByRole("button", { name: "打开账户菜单" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /今日/ })).toBeDisabled();
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
