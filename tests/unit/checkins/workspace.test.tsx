import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { checkInKeys } from "@/features/checkins/queries";
import { TestQueryProvider } from "@/tests/helpers/test-query-provider";

const imagePreparation = vi.hoisted(() => {
  let complete: (() => void) | null = null;
  return {
    begin(
      onChange: (selection: { file: File | null; removeImage: boolean }) => void | Promise<void>,
      onPreparationChange?: (isPreparing: boolean) => void,
    ) {
      onPreparationChange?.(true);
      complete = () => {
        void Promise.resolve(
          onChange({
            file: new File(["replacement"], "replacement.png", { type: "image/png" }),
            removeImage: false,
          }),
        ).finally(() => onPreparationChange?.(false));
      };
    },
    complete() {
      if (!complete) throw new Error("No image preparation is pending");
      complete();
    },
    reset() {
      complete = null;
    },
  };
});

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
    onPreparationChange,
    removeImage,
    isPreparing = false,
  }: {
    disabled?: boolean;
    file: File | null;
    onChange: (selection: { file: File | null; removeImage: boolean }) => void | Promise<void>;
    onPreparationChange?: (isPreparing: boolean) => void;
    removeImage: boolean;
    isPreparing?: boolean;
  }) => (
    <div>
      <input aria-label="添加图片笔记" disabled={disabled || isPreparing} type="file" />
      <button
        disabled={disabled || isPreparing}
        onClick={() => imagePreparation.begin(onChange, onPreparationChange)}
        type="button"
      >
        开始测试图片整理
      </button>
      <button
        disabled={disabled || isPreparing}
        onClick={() => void onChange({
          file: new File(["replacement"], "replacement.png", { type: "image/png" }),
          removeImage: false,
        })}
        type="button"
      >
        替换测试图片
      </button>
      <button
        disabled={disabled || isPreparing}
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
      <CheckInWorkspace initialDate={initialDate} initialToday={getTodayKey()} />
    </TestQueryProvider>,
  );
}

function renderWorkspaceWithCachedRecord(initialDate: string, cachedRecord: CheckInRecord | null) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(checkInKeys.date(initialDate), cachedRecord);
  const view = render(
    <QueryClientProvider client={queryClient}>
      <CheckInWorkspace initialDate={initialDate} initialToday={getTodayKey()} />
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
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

async function flushFakeTimerWork() {
  for (let index = 0; index < 3; index += 1) {
    await act(async () => {
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(1);
    });
  }
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
  imagePreparation.reset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
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
    expect(screen.getByRole("status", { name: "正在读取月度记录" })).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /7月24日/ })).toBeDisabled();
    });

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
        <CheckInWorkspace initialDate="2026-07-23" initialToday={getTodayKey()} />
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

  it("locks a cached record while it revalidates and then hydrates the fresh version", async () => {
    const date = "2026-07-23";
    const cached = record(date, "缓存初版", 1);
    const fresh = record(date, "云端新版本", 2);
    const refresh = deferred<Response>();
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
          return Promise.resolve(response({ ok: true, data: fresh, requestId: "save-request" }));
        }
        if (path.endsWith(`/${date}`)) return refresh.promise;
        return Promise.resolve(missingCheckIn());
      }),
    );

    renderWorkspaceWithCachedRecord(date, cached);
    const user = userEvent.setup();
    const attention = screen.getByLabelText("attention");
    await waitFor(() => expect(attention).toHaveValue("缓存初版"));
    expect(attention).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();

    refresh.resolve(response({ ok: true, data: fresh, requestId: "refresh-request" }));

    await waitFor(() => expect(attention).toHaveValue("云端新版本"));
    expect(attention).toBeEnabled();
    await user.type(attention, "，本地补充");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(saveBodies).toHaveLength(1));
    expect(saveBodies[0]).toMatchObject({ version: 2, attention: "云端新版本，本地补充" });
  });

  it("keeps a dirty cached draft on its captured version after a background refresh", async () => {
    const date = "2026-07-23";
    const cached = record(date, "缓存初版", 1);
    const fresh = record(date, "云端新版本", 2);
    const refresh = deferred<Response>();
    const saveBodies: unknown[] = [];
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
        }
        if (init?.method === "PUT") {
          saveBodies.push(JSON.parse(String(init.body)));
          return Promise.resolve(response({
            ok: false,
            error: {
              code: "VERSION_CONFLICT",
              message: "云端记录已更新，请确认后重试",
              details: { current: fresh },
            },
            requestId: "conflict-request",
          }, 409));
        }
        if (path.endsWith(`/${date}`)) {
          reads += 1;
          return reads === 1
            ? Promise.resolve(response({ ok: true, data: cached, requestId: "initial-request" }))
            : refresh.promise;
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    const { queryClient } = renderWorkspaceWithCachedRecord(date, cached);
    const user = userEvent.setup();
    const attention = screen.getByLabelText("attention");
    await waitFor(() => expect(attention).toBeEnabled());
    await user.type(attention, "，本地补充");

    act(() => {
      void queryClient.invalidateQueries({ queryKey: checkInKeys.date(date) });
    });
    await waitFor(() => expect(reads).toBe(2));
    expect(attention).toBeDisabled();

    refresh.resolve(response({ ok: true, data: fresh, requestId: "refresh-request" }));

    await waitFor(() => expect(attention).toBeEnabled());
    expect(attention).toHaveValue("缓存初版，本地补充");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(saveBodies).toHaveLength(1));
    expect(saveBodies[0]).toMatchObject({ version: 1, attention: "缓存初版，本地补充" });
    expect(await screen.findByRole("dialog", { name: "云端记录已更新" })).toBeVisible();
  });

  it("does not save while image preparation is pending and resumes after it commits", async () => {
    const date = "2026-07-23";
    const saveBodies: unknown[] = [];
    vi.mocked(uploadCheckInImage).mockResolvedValue("checkin-images/user/prepared.png");
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
        }
        if (init?.method === "PUT") {
          saveBodies.push(JSON.parse(String(init.body)));
          return Promise.resolve(response({
            ok: true,
            data: {
              ...record(date, "正在整理的内容"),
              imagePath: "checkin-images/user/prepared.png",
              imageName: "replacement.png",
            },
            requestId: "save-request",
          }));
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    renderWorkspace(date);
    const user = userEvent.setup();
    const attention = screen.getByLabelText("attention");
    await waitForEditorReady();
    await user.type(attention, "正在整理的内容");
    await user.click(screen.getByRole("button", { name: "开始测试图片整理" }));

    await waitFor(() => expect(screen.getByText("正在整理图片，请稍候")).toBeVisible());
    expect(attention).toBeDisabled();
    expect(screen.getByRole("button", { name: /完成打卡/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "还原未保存的修改" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /今日/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /7月24日/ })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /完成打卡/ }));
    expect(saveBodies).toHaveLength(0);

    act(() => {
      imagePreparation.complete();
    });

    await waitFor(() => expect(screen.getByRole("button", { name: /完成打卡/ })).toBeEnabled());
    expect(screen.getByLabelText("图片草稿状态")).toHaveTextContent("replacement.png:false");
    await user.click(screen.getByRole("button", { name: /完成打卡/ }));

    await waitFor(() => expect(saveBodies).toHaveLength(1));
    expect(saveBodies[0]).toMatchObject({ imageName: "replacement.png" });
  });

  it("treats unrelated and malformed 409 responses as ordinary errors without mutating cloud caches", async () => {
    const date = "2026-07-23";
    const initial = record(date, "缓存中的初版");
    const unrelatedCurrent = record(date, "不应载入的 409 内容", 2);
    let saves = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({
            ok: true,
            data: [{ date, attention: initial.attention, hasImage: false, version: 1, updatedAt: initial.updatedAt }],
            requestId: "month-request",
          }));
        }
        if (init?.method === "PUT") {
          saves += 1;
          if (saves === 2) {
            return Promise.resolve(response({
              ok: false,
              error: {
                code: "VERSION_CONFLICT",
                message: "云端记录已更新，请确认后重试",
                details: {},
              },
              requestId: "malformed-409",
            }, 409));
          }
          return Promise.resolve(response({
            ok: false,
            error: {
              code: "RATE_LIMITED",
              message: "请稍后再试",
              details: { current: unrelatedCurrent },
            },
            requestId: "ordinary-409",
          }, 409));
        }
        if (path.endsWith(`/${date}`)) {
          return Promise.resolve(response({ ok: true, data: initial, requestId: "date-request" }));
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    renderWorkspace(date);
    const user = userEvent.setup();
    const attention = screen.getByLabelText("attention");
    await waitFor(() => expect(attention).toHaveValue("缓存中的初版"));
    await user.type(attention, "，本地修改");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(screen.getByText("请稍后再试")).toBeVisible());
    expect(screen.queryByRole("dialog", { name: "云端记录已更新" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("attention")).toHaveValue("缓存中的初版，本地修改");
    expect(screen.getByRole("button", { name: new RegExp(`${formatCalendarDate(date)}，已保存：缓存中的初版`) })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(screen.getByText("服务返回内容不正确，请稍后再试")).toBeVisible());
    expect(screen.queryByRole("dialog", { name: "云端记录已更新" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("attention")).toHaveValue("缓存中的初版，本地修改");
    expect(screen.getByRole("button", { name: new RegExp(`${formatCalendarDate(date)}，已保存：缓存中的初版`) })).toBeVisible();
  });

  it("locks every workspace decision while reset waits for candidate image cleanup", async () => {
    const date = "2026-07-23";
    const initial = record(date, "云端初版");
    const cleanup = deferred<void>();
    vi.mocked(uploadCheckInImage).mockResolvedValue("checkin-images/user/pending.png");
    vi.mocked(deleteCheckInImage).mockReturnValue(cleanup.promise);
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
              details: { current: initial },
            },
            requestId: "conflict-request",
          }, 409));
        }
        if (path.endsWith(`/${date}`)) {
          return Promise.resolve(response({ ok: true, data: initial, requestId: "date-request" }));
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    const { container } = renderWorkspace(date);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByLabelText("attention")).toHaveValue("云端初版"));
    await user.click(screen.getByRole("button", { name: "替换测试图片" }));
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await user.click(await screen.findByRole("button", { name: "保留本地内容" }));
    await user.click(screen.getByRole("button", { name: "还原未保存的修改" }));

    await waitFor(() => expect(deleteCheckInImage).toHaveBeenCalledWith("checkin-images/user/pending.png"));
    expect(screen.getByLabelText("attention")).toBeDisabled();
    expect(screen.getByLabelText("添加图片笔记")).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "还原未保存的修改" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /今日/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /7月24日/ })).toBeDisabled();
    expect(container.querySelector(".checkin-form")).toHaveAttribute("aria-busy", "true");

    cleanup.resolve();

    await waitFor(() => expect(screen.getByLabelText("attention")).toHaveValue("云端初版"));
    expect(container.querySelector(".checkin-form")).toHaveAttribute("aria-busy", "false");
  });

  it("keeps the dirty switch dialog inert until candidate cleanup completes before discarding", async () => {
    const date = "2026-07-23";
    const cleanup = deferred<void>();
    vi.mocked(uploadCheckInImage).mockResolvedValue("checkin-images/user/pending.png");
    vi.mocked(deleteCheckInImage).mockReturnValue(cleanup.promise);
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
              details: { current: null },
            },
            requestId: "conflict-request",
          }, 409));
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    renderWorkspace(date);
    const user = userEvent.setup();
    await waitForEditorReady();
    await user.type(screen.getByLabelText("attention"), "待放弃的内容");
    await user.click(screen.getByRole("button", { name: "替换测试图片" }));
    await user.click(screen.getByRole("button", { name: /完成打卡/ }));
    await user.click(await screen.findByRole("button", { name: "保留本地内容" }));
    await user.click(screen.getByRole("button", { name: /7月24日/ }));
    await user.click(screen.getByRole("button", { name: "放弃修改" }));

    await waitFor(() => expect(deleteCheckInImage).toHaveBeenCalledWith("checkin-images/user/pending.png"));
    expect(screen.getByRole("button", { name: "保存并切换" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "放弃修改" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    expect(screen.getByRole("heading", { name: formatDate(date) })).toBeVisible();

    cleanup.resolve();

    await waitFor(() => expect(screen.getByRole("heading", { name: formatDate("2026-07-24") })).toBeVisible());
  });

  it("keeps the conflict controls inert until loading the cloud version cleans its candidate", async () => {
    const date = "2026-07-23";
    const cloud = record(date, "云端新版本", 2);
    const cleanup = deferred<void>();
    vi.mocked(uploadCheckInImage).mockResolvedValue("checkin-images/user/pending.png");
    vi.mocked(deleteCheckInImage).mockReturnValue(cleanup.promise);
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
              details: { current: cloud },
            },
            requestId: "conflict-request",
          }, 409));
        }
        if (path.endsWith(`/${date}`)) {
          return Promise.resolve(response({ ok: true, data: record(date, "云端初版"), requestId: "date-request" }));
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    renderWorkspace(date);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByLabelText("attention")).toHaveValue("云端初版"));
    await user.click(screen.getByRole("button", { name: "替换测试图片" }));
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await user.click(await screen.findByRole("button", { name: "载入云端版本" }));

    await waitFor(() => expect(deleteCheckInImage).toHaveBeenCalledWith("checkin-images/user/pending.png"));
    expect(screen.getByRole("button", { name: "保留本地内容" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "载入云端版本" })).toBeDisabled();
    expect(screen.getByLabelText("attention")).toHaveValue("云端初版");

    cleanup.resolve();

    await waitFor(() => expect(screen.getByLabelText("attention")).toHaveValue("云端新版本"));
    expect(screen.queryByRole("dialog", { name: "云端记录已更新" })).not.toBeInTheDocument();
  });

  it("locks the editor after a selected-record error and retries without clearing its draft", async () => {
    const date = "2026-07-23";
    let attempts = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
        }
        if (path.endsWith(`/${date}`)) {
          attempts += 1;
          if (attempts === 1) {
            return Promise.resolve(response({
              ok: false,
              error: { code: "SESSION_EXPIRED", message: "登录已失效，请重新登录" },
              requestId: "expired-request",
            }, 401));
          }
          return Promise.resolve(response({ ok: true, data: record(date, "重试后的云端内容"), requestId: "retry-request" }));
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    renderWorkspace(date);
    const user = userEvent.setup();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("登录已失效，请重新登录");
    expect(screen.getByLabelText("attention")).toBeDisabled();
    expect(screen.getByRole("button", { name: "重试" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => expect(screen.getByLabelText("attention")).toBeEnabled());
    expect(screen.getByLabelText("attention")).toHaveValue("重试后的云端内容");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
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

  it("defers a later image decision until an earlier replacement cleanup resolves", async () => {
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
    expect(screen.getByRole("button", { name: "测试移除图片" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "测试移除图片" }));

    expect(screen.getByLabelText("图片草稿状态")).toHaveTextContent("replacement.png:false");
    cleanup.resolve();
    await waitFor(() => expect(screen.getByRole("button", { name: "测试移除图片" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "测试移除图片" }));

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
          initialToday={getTodayKey()}
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

  it("adopts the cloud version for a keep-local retry without replacing local fields", async () => {
    const date = "2026-07-23";
    const cloud = {
      ...record(date, "云端的新版本", 2),
      updatedAt: "2026-07-25T08:45:00.000Z",
    };
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
          return Promise.resolve(response({
            ok: true,
            data: saveBodies.length > 1 ? saved : record(date, "云端初版"),
            requestId: "date-request",
          }));
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
    const cloudRecord = within(screen.getByLabelText("云端记录"));
    const formattedUpdatedAt = new Intl.DateTimeFormat("zh-CN", {
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(cloud.updatedAt));
    expect(cloudRecord.getByText(new RegExp(`云端更新于 ${formattedUpdatedAt}`))).toBeVisible();
    expect(cloudRecord.queryByText(new RegExp(formatDate(date)))).not.toBeInTheDocument();
    const keepLocal = screen.getByRole("button", { name: "保留本地内容" });
    const loadCloud = screen.getByRole("button", { name: "载入云端版本" });
    await waitFor(() => expect(keepLocal).toHaveFocus());
    await user.tab({ shift: true });
    expect(loadCloud).toHaveFocus();
    await user.tab();
    expect(keepLocal).toHaveFocus();

    await user.click(keepLocal);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "云端记录已更新" })).not.toBeInTheDocument());
    expect(targetButton).toHaveFocus();
    expect(conflict).not.toBeInTheDocument();
    expect(attention).toHaveValue("云端初版，本地补充");

    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(saveBodies).toHaveLength(2));
    expect(saveBodies[1]).toMatchObject({ version: 2, attention: "云端初版，本地补充" });
    await waitFor(() => expect(attention).toHaveValue("云端初版，本地补充"));
  });

  it("adopts a null base version after keeping a locally edited cloud-deleted record", async () => {
    const date = "2026-07-23";
    const saved = record(date, "云端初版，本地补充", 1);
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
            return Promise.resolve(response({
              ok: false,
              error: {
                code: "VERSION_CONFLICT",
                message: "云端记录已更新，请确认后重试",
                details: { current: null },
              },
              requestId: "deleted-conflict-request",
            }, 409));
          }
          return Promise.resolve(response({ ok: true, data: saved, requestId: "retry-request" }));
        }
        if (path.endsWith(`/${date}`)) {
          return Promise.resolve(response({
            ok: true,
            data: record(date, "云端初版"),
            requestId: "date-request",
          }));
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    renderWorkspace(date);
    const user = userEvent.setup();
    const attention = screen.getByLabelText("attention");
    await waitFor(() => expect(attention).toHaveValue("云端初版"));
    await user.type(attention, "，本地补充");
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await user.click(await screen.findByRole("button", { name: "保留本地内容" }));

    expect(attention).toHaveValue("云端初版，本地补充");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(saveBodies).toHaveLength(2));
    expect(saveBodies[1]).toMatchObject({
      version: null,
      attention: "云端初版，本地补充",
    });
  });

  it.each([
    {
      label: "network failure",
      firstFailure: () => Promise.reject(new TypeError("network unavailable")),
      message: "网络连接失败，请检查网络后重试",
    },
    {
      label: "aborted request",
      firstFailure: () => Promise.reject(new DOMException("aborted", "AbortError")),
      message: "网络连接失败，请检查网络后重试",
    },
    {
      label: "malformed response",
      firstFailure: () => Promise.resolve(new Response("<html>bad gateway</html>", { status: 502 })),
      message: "服务返回内容不正确，请稍后再试",
    },
    {
      label: "service failure",
      firstFailure: () => Promise.resolve(response({
        ok: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "服务暂时不可用，请稍后再试",
        },
        requestId: "service-request",
      }, 503)),
      message: "服务暂时不可用，请稍后再试",
    },
  ])("retains and reuses its candidate after an ambiguous $label", async ({ firstFailure, message }) => {
    const date = "2026-07-23";
    const candidatePath = "checkin-images/user/candidate.png";
    const saveBodies: Array<Record<string, unknown>> = [];
    let saves = 0;
    vi.mocked(uploadCheckInImage).mockResolvedValue(candidatePath);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
        }
        if (init?.method === "PUT") {
          saves += 1;
          saveBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
          if (saves === 1) return firstFailure();
          return Promise.resolve(response({
            ok: true,
            data: {
              ...record(date, "保留候选图片"),
              imagePath: candidatePath,
              imageName: "replacement.png",
            },
            requestId: "retry-request",
          }));
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    renderWorkspace(date);
    const user = userEvent.setup();
    await waitForEditorReady();
    await user.type(screen.getByLabelText("attention"), "保留候选图片");
    await user.click(screen.getByRole("button", { name: "替换测试图片" }));
    await user.click(screen.getByRole("button", { name: /完成打卡/ }));

    await waitFor(() => expect(screen.getByText(message)).toBeVisible());
    expect(deleteCheckInImage).not.toHaveBeenCalled();
    expect(uploadCheckInImage).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("图片草稿状态")).toHaveTextContent("replacement.png:false");

    await user.click(screen.getByRole("button", { name: /完成打卡/ }));

    await waitFor(() => expect(saveBodies).toHaveLength(2));
    expect(uploadCheckInImage).toHaveBeenCalledTimes(1);
    expect(saveBodies[1]).toMatchObject({ imagePath: candidatePath });
  });

  it("does not delete an ambiguous candidate when the local draft is later reset", async () => {
    const date = "2026-07-23";
    const candidatePath = "checkin-images/user/maybe-committed.png";
    vi.mocked(uploadCheckInImage).mockResolvedValue(candidatePath);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
        }
        if (init?.method === "PUT") {
          return Promise.reject(new TypeError("connection closed after request"));
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    renderWorkspace(date);
    const user = userEvent.setup();
    await waitForEditorReady();
    await user.type(screen.getByLabelText("attention"), "可能已经写入云端");
    await user.click(screen.getByRole("button", { name: "替换测试图片" }));
    await user.click(screen.getByRole("button", { name: /完成打卡/ }));
    await waitFor(() => {
      expect(screen.getByText("网络连接失败，请检查网络后重试")).toBeVisible();
    });

    await user.click(screen.getByRole("button", { name: "还原未保存的修改" }));

    await waitFor(() => expect(screen.getByLabelText("attention")).toHaveValue(""));
    expect(deleteCheckInImage).not.toHaveBeenCalled();
  });

  it.each([
    [401, "SESSION_EXPIRED"],
    [403, "FORBIDDEN_IMAGE_PATH"],
    [404, "NOT_FOUND"],
    [422, "VALIDATION_ERROR"],
  ])("cleans its candidate after a definite %i %s rejection", async (status, code) => {
    const date = "2026-07-23";
    const candidatePath = "checkin-images/user/rejected.png";
    vi.mocked(uploadCheckInImage).mockResolvedValue(candidatePath);
    vi.mocked(deleteCheckInImage).mockResolvedValue(undefined);
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
            error: { code, message: "保存请求已被明确拒绝" },
            requestId: "rejected-request",
          }, status));
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    renderWorkspace(date);
    const user = userEvent.setup();
    await waitForEditorReady();
    await user.type(screen.getByLabelText("attention"), "明确拒绝");
    await user.click(screen.getByRole("button", { name: "替换测试图片" }));
    await user.click(screen.getByRole("button", { name: /完成打卡/ }));

    await waitFor(() => expect(deleteCheckInImage).toHaveBeenCalledWith(candidatePath));
    expect(screen.getByLabelText("图片草稿状态")).toHaveTextContent("replacement.png:false");
  });

  it("reconciles a server day to browser-local today after mount", async () => {
    vi.useFakeTimers();
    const browserNow = new Date(2026, 6, 24, 9, 30, 0);
    vi.setSystemTime(browserNow);
    const browserToday = getTodayKey();
    const previousDay = new Date(
      browserNow.getFullYear(),
      browserNow.getMonth(),
      browserNow.getDate() - 1,
      12,
    );
    const serverToday = getTodayKey(previousDay);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path.startsWith("/api/checkins/stats?")) {
          return Promise.resolve(response({
            ok: true,
            data: {
              totalCount: 0,
              currentStreak: 0,
              hasTodayRecord: false,
            },
            requestId: "stats-request",
          }));
        }
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    render(
      <TestQueryProvider>
        <CheckInWorkspace initialDate={serverToday} initialToday={serverToday} />
      </TestQueryProvider>,
    );
    await flushFakeTimerWork();

    expect(screen.getByRole("heading", { name: formatDate(browserToday) })).toBeVisible();
    expect(screen.getByText(new RegExp(`AI LEARNING JOURNAL · ${formatDate(browserToday)}`))).toBeVisible();
  });

  it("advances local today at midnight without replacing an unsaved draft", async () => {
    vi.useFakeTimers();
    const beforeMidnight = new Date(2026, 6, 24, 23, 59, 50);
    vi.setSystemTime(beforeMidnight);
    const oldToday = getTodayKey();
    const nextMidnight = new Date(
      beforeMidnight.getFullYear(),
      beforeMidnight.getMonth(),
      beforeMidnight.getDate() + 1,
    );
    const nextToday = getTodayKey(nextMidnight);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path.startsWith("/api/checkins/stats?")) {
          return Promise.resolve(response({
            ok: true,
            data: {
              totalCount: 0,
              currentStreak: 0,
              hasTodayRecord: false,
            },
            requestId: "stats-request",
          }));
        }
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    render(
      <TestQueryProvider>
        <CheckInWorkspace initialDate={oldToday} initialToday={oldToday} />
      </TestQueryProvider>,
    );
    await flushFakeTimerWork();
    const attention = screen.getByLabelText("attention");
    expect(attention).toBeEnabled();
    fireEvent.change(attention, { target: { value: "跨过午夜也不能丢" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(nextMidnight.getTime() - beforeMidnight.getTime() + 1);
    });

    expect(attention).toHaveValue("跨过午夜也不能丢");
    expect(screen.getByRole("heading", { name: formatDate(oldToday) })).toBeVisible();
    expect(screen.getByText(new RegExp(`AI LEARNING JOURNAL · ${formatDate(nextToday)}`))).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: new RegExp(`${formatCalendarDate(nextToday)}.*今天`),
      }),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /今日/ }));
    expect(screen.getByRole("dialog", { name: "尚未保存" })).toHaveTextContent(
      formatDate(nextToday),
    );
    expect(attention).toHaveValue("跨过午夜也不能丢");
  });
});
