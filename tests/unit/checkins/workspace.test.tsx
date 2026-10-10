import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckInWorkspace } from "@/features/checkins/checkin-workspace";
import { deleteCheckInImage, uploadCheckInImage } from "@/features/checkins/api";
import {
  deleteAttentionDraftDatabase,
  loadDraft,
  saveDraft,
} from "@/lib/indexed-db/drafts";
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
      <output aria-label="图片上传禁用状态">{String(disabled)}</output>
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
  await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toBeEnabled());
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

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await deleteAttentionDraftDatabase();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  window.dispatchEvent(new Event("online"));
});

describe("CheckInWorkspace", () => {
  it("can toggle the calendar when browser preference storage is unavailable", async () => {
    vi.stubGlobal("localStorage", {
      getItem() { throw new Error("Storage unavailable"); },
      setItem() { throw new Error("Storage unavailable"); },
    });
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/api/checkins?month=")) return Promise.resolve(response({ ok: true, data: [], requestId: "list" }));
      if (path.startsWith("/api/checkins/stats")) return Promise.resolve(response({ ok: true, data: { totalCount: 0, currentStreak: 0, hasTodayRecord: false }, requestId: "stats" }));
      if (path === "/api/me") return Promise.resolve(response({ ok: true, data: { profile: null }, requestId: "profile" }));
      return Promise.resolve(missingCheckIn());
    }));
    renderWorkspace(getTodayKey());
    await waitForEditorReady();
    await userEvent.click(screen.getByRole("button", { name: "收起日历" }));
    expect(document.getElementById("learning-calendar")).not.toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "展开日历" }));
    expect(document.getElementById("learning-calendar")).toBeVisible();
  });

  it("collapses the calendar without remounting or losing unsaved writing, and remembers the choice", async () => {
    const date = getTodayKey();
    localStorage.removeItem("aura-calendar-collapsed");
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/api/checkins?month=")) return Promise.resolve(response({ ok: true, data: [], requestId: "list" }));
      if (path.startsWith("/api/checkins/stats")) return Promise.resolve(response({ ok: true, data: { totalCount: 0, currentStreak: 0, hasTodayRecord: false }, requestId: "stats" }));
      if (path === "/api/me") return Promise.resolve(response({ ok: true, data: { profile: null }, requestId: "profile" }));
      return Promise.resolve(missingCheckIn());
    }));
    const view = renderWorkspace(date);
    await waitForEditorReady();
    const user = userEvent.setup();
    const editor = screen.getByLabelText("今日知识主题");
    await user.type(editor, "未保存的知识主题");
    await user.type(field("inspiration"), "先保留我的解释");
    await user.click(screen.getByRole("button", { name: "收起日历" }));
    expect(screen.getByRole("button", { name: "展开日历" })).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById("learning-calendar")).not.toBeVisible();
    expect(screen.getByLabelText("今日知识主题")).toBe(editor);
    expect(editor).toHaveValue("未保存的知识主题");
    expect(field("inspiration")).toHaveValue("先保留我的解释");
    expect(localStorage.getItem("aura-calendar-collapsed")).toBe("true");
    view.unmount();
    renderWorkspace(date);
    await waitFor(() => expect(screen.getByRole("button", { name: "展开日历" })).toBeVisible());
    await user.click(screen.getByRole("button", { name: "展开日历" }));
    expect(document.getElementById("learning-calendar")).toBeVisible();
    expect(localStorage.getItem("aura-calendar-collapsed")).toBe("false");
    localStorage.removeItem("aura-calendar-collapsed");
  });

  it("keeps the same mounted editor and image draft when knowledge view opens and closes", async () => {
    const date = getTodayKey();
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path.includes("/api/checkins?month=") || path === "/api/knowledge-narratives") return Promise.resolve(response({ ok: true, data: [], requestId: "list" }));
      if (path.startsWith("/api/checkins/stats")) return Promise.resolve(response({ ok: true, data: { totalCount: 0, currentStreak: 0, hasTodayRecord: false }, requestId: "stats" }));
      if (path === "/api/me") return Promise.resolve(response({ ok: true, data: { profile: null }, requestId: "profile" }));
      return Promise.resolve(missingCheckIn());
    }));
    renderWorkspace(date);
    const user = userEvent.setup();
    await waitForEditorReady();
    const editor = screen.getByLabelText("今日知识主题");
    await user.type(editor, "还没保存的理解");
    await user.click(screen.getByRole("button", { name: "替换测试图片" }));
    await user.click(screen.getByRole("button", { name: "串联知识" }));
    expect(editor).toBeInTheDocument();
    expect(editor).not.toBeVisible();
    expect(screen.getByRole("heading", { name: "知识脉络" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "返回学习记录" }));
    expect(screen.getByLabelText("今日知识主题")).toBe(editor);
    expect(editor).toHaveValue("还没保存的理解");
    expect(screen.getByLabelText("图片草稿状态")).toHaveTextContent("replacement.png:false");
    expect(deleteCheckInImage).not.toHaveBeenCalled();
  });

  it.each(["", "我觉得两个公式之间的展开关系很有趣"])("preserves personal reflection %j when AI output fills the draft", async (reflection) => {
    const date = getTodayKey();
    const jobId = "10000000-0000-4000-8000-000000000001";
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/ai/generations" && init?.method === "POST") {
        return Promise.resolve(response({
          ok: true,
          data: {
            jobId,
            status: "queued",
            pollAfterMs: 1,
            quota: { used: 1, reserved: 1, consumed: 0, limit: 5, remaining: 4 },
          },
          requestId: "ai-create",
        }, 202));
      }
      if (path === `/api/ai/generations/${jobId}`) {
        return Promise.resolve(response({
          ok: true,
          data: {
            jobId,
            status: "succeeded",
            stage: "complete",
            result: {
              attention: "AI 标题",
              summary: "AI 结构化小结",
              inspiration: "AI 延伸灵感",
              sourceTitle: "示例资料",
              warnings: [],
            },
          },
          requestId: "ai-read",
        }));
      }
      if (path.includes("/api/checkins?month=")) {
        return Promise.resolve(response({ ok: true, data: [], requestId: "month" }));
      }
      if (path.includes("/api/checkins/stats?")) {
        return Promise.resolve(response({
          ok: true,
          data: { totalCount: 0, currentStreak: 0, hasTodayRecord: false },
          requestId: "stats",
        }));
      }
      if (path.includes(`/api/checkins/${date}`)) return Promise.resolve(missingCheckIn());
      if (path === "/api/me") return Promise.resolve(response({ ok: true, data: { profile: null }, requestId: "profile" }));
      return Promise.resolve(response({ ok: true, data: {}, requestId: "other" }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(
      <TestQueryProvider>
        <CheckInWorkspace initialDate={date} initialToday={date} userId="ai-user" />
      </TestQueryProvider>,
    );
    await waitForEditorReady();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /AI 提炼/ }));
    await waitForEditorReady();
    await user.type(
      screen.getByLabelText(/学习资料来源/),
      "https://example.com/article",
    );
    if (reflection) await user.type(field<HTMLTextAreaElement>("inspiration"), reflection);
    await user.click(screen.getByRole("button", { name: "生成知识小结" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: "AI 标题" })).toBeVisible());
    expect(screen.getByText("AI 结构化小结")).toBeVisible();
    expect(field<HTMLTextAreaElement>("inspiration")).toHaveValue(reflection);
    expect(screen.getByText("AI 小结已生成，请审阅后手动保存")).toBeVisible();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
  });

  it.each([false, true])("preserves saved reflections after saving and switching, with expired cache: %s", async (expireCache) => {
    const date = getTodayKey();
    const otherDate = `${date.slice(0, 8)}${date.endsWith("10") ? "11" : "10"}`;
    const jobId = "10000000-0000-4000-8000-000000000001";
    const completed = deferred<Response>();
    let cloud: CheckInRecord | null = null;
    let polling = false;
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path === "/api/ai/generations" && init?.method === "POST") return Promise.resolve(response({ ok: true, data: {
        jobId, status: "queued", pollAfterMs: 1,
        quota: { used: 1, reserved: 1, consumed: 0, limit: 5, remaining: 4 },
      }, requestId: "create" }, 202));
      if (path === `/api/ai/generations/${jobId}`) { polling = true; return completed.promise; }
      if (path.startsWith(`/api/checkins/${date}`)) {
        if (init?.method === "PUT") cloud = { ...record(date, "Agent 的组成"), ...JSON.parse(init.body as string), version: 1 };
        return Promise.resolve(cloud ? response({ ok: true, data: cloud, requestId: "record" }) : missingCheckIn());
      }
      if (path.startsWith(`/api/checkins/${otherDate}`)) return Promise.resolve(missingCheckIn());
      if (path.includes("/api/checkins?month=") || path === "/api/knowledge-narratives") return Promise.resolve(response({ ok: true, data: [], requestId: "list" }));
      if (path.startsWith("/api/checkins/stats")) return Promise.resolve(response({ ok: true, data: { totalCount: cloud ? 1 : 0, currentStreak: 0, hasTodayRecord: !!cloud }, requestId: "stats" }));
      if (path === "/api/me") return Promise.resolve(response({ ok: true, data: { profile: null }, requestId: "profile" }));
      return Promise.resolve(missingCheckIn());
    }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={queryClient}><CheckInWorkspace initialDate={date} initialToday={date} userId="ai-user" /></QueryClientProvider>);
    await waitForEditorReady();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /AI 提炼/ }));
    await waitForEditorReady();
    await user.type(screen.getByLabelText("今日知识主题"), "Agent 的组成");
    await user.type(field("inspiration"), "已经保存的个人理解");
    await user.type(field("source-url"), "https://example.com/agent");
    await user.click(screen.getByRole("button", { name: "生成知识小结" }));
    await waitFor(() => expect(polling).toBe(true));
    await user.click(screen.getByRole("button", { name: `${formatCalendarDate(otherDate)}，暂无记录` }));
    await user.click(screen.getByRole("button", { name: "保存并切换" }));
    await waitFor(() => expect(screen.getByText(formatDate(otherDate), { selector: ".editor-date" })).toBeVisible());
    await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toHaveValue(""));
    await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toBeEnabled());
    expect(await loadDraft("ai-user", date, "ai")).toBeUndefined();
    if (expireCache) queryClient.removeQueries({ queryKey: checkInKeys.date(date, "ai"), exact: true });
    completed.resolve(response({ ok: true, data: { jobId, status: "succeeded", stage: "complete", result: {
      attention: "AI 标题", summary: "AI 骨架小结", inspiration: "旧版 AI 感想", sourceTitle: "Agent 入门", warnings: [],
    } }, requestId: "complete" }));
    await waitFor(async () => expect(await loadDraft("ai-user", date, "ai")).toMatchObject({
      summary: "AI 骨架小结", inspiration: "已经保存的个人理解", baseVersion: 1,
    }));
  });

  it("restores a newer local draft using the authenticated id even when the profile is unavailable", async () => {
    const date = getTodayKey();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    await saveDraft({
      userId: "authenticated-subject",
      date,
      attention: "本地草稿",
      sourceUrl: "",
      summary: "",
      inspiration: "",
      imageBlob: null,
      imageName: "",
      removeImage: false,
      baseVersion: 1,
      updatedAt: `${date}T11:00:00.000Z`,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
        }
        if (path.includes("/api/checkins/stats?")) {
          return Promise.resolve(response({ ok: true, data: { totalCount: 0, currentStreak: 0, hasTodayRecord: false }, requestId: "stats-request" }));
        }
        if (path.includes("/api/checkins/")) {
          return Promise.resolve(response({ ok: true, data: record(date, "云端内容"), requestId: "date-request" }));
        }
        return Promise.resolve(response({ ok: true, data: { profile: { id: "profile", displayName: "学习者", avatarKey: 1 } }, requestId: "profile-request" }));
      }),
    );

    render(
      <TestQueryProvider>
        <CheckInWorkspace
          initialDate={date}
          initialProfile={null}
          initialToday={date}
          userId="authenticated-subject"
        />
      </TestQueryProvider>,
    );

    await waitFor(() => expect(field<HTMLInputElement>("attention")).toHaveValue("本地草稿"));
    expect(screen.getByText("已恢复本地草稿")).toBeVisible();
  });

  it("keeps the form editable after an offline cloud-read failure and persists an image draft without uploading", async () => {
    const date = getTodayKey();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));

    const view = render(
      <TestQueryProvider>
        <CheckInWorkspace initialDate={date} initialToday={date} userId="authenticated-subject" />
      </TestQueryProvider>,
    );

    await waitFor(() => expect(screen.getByText("离线，内容已保存在此浏览器")).toBeVisible());
    await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toBeEnabled());
    const attention = screen.getByLabelText("今日知识主题");
    await userEvent.setup().type(attention, "离线内容");
    expect(screen.getByRole("button", { name: /完成打卡/ })).toBeDisabled();
    expect(screen.getByLabelText("添加图片笔记")).toBeEnabled();
    await userEvent.setup().click(screen.getByRole("button", { name: "替换测试图片" }));

    await waitFor(
      async () => {
        const stored = await loadDraft("authenticated-subject", date);
        expect(stored).toMatchObject({
          attention: "离线内容",
          imageName: "replacement.png",
        });
        expect(typeof stored?.imageBlob).toBe("object");
      },
      { timeout: 1_000 },
    );
    expect(uploadCheckInImage).not.toHaveBeenCalled();

    view.unmount();
    render(
      <TestQueryProvider>
        <CheckInWorkspace initialDate={date} initialToday={date} userId="authenticated-subject" />
      </TestQueryProvider>,
    );
    await waitFor(() => {
      expect(screen.getByLabelText("图片草稿状态")).toHaveTextContent("replacement.png:false");
    });

    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    act(() => window.dispatchEvent(new Event("online")));
    expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(0);
  });

  it("keeps an offline image preparation when connectivity returns before compression settles", async () => {
    const date = getTodayKey();
    Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));

    render(
      <TestQueryProvider>
        <CheckInWorkspace initialDate={date} initialToday={date} userId="authenticated-subject" />
      </TestQueryProvider>,
    );

    await waitForEditorReady();
    await userEvent.setup().type(screen.getByLabelText("今日知识主题"), "离线图片");
    await userEvent.setup().click(screen.getByRole("button", { name: "开始测试图片整理" }));
    await waitFor(() => expect(screen.getByText("正在整理图片")).toBeVisible());

    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
    act(() => window.dispatchEvent(new Event("online")));
    await waitFor(() => {
      expect(screen.getByLabelText("图片上传禁用状态")).toHaveTextContent("false");
    });
    act(() => imagePreparation.complete());

    await waitFor(() => {
      expect(screen.getByLabelText("图片草稿状态")).toHaveTextContent("replacement.png:false");
    });
    await waitFor(
      async () => {
        const stored = await loadDraft("authenticated-subject", date);
        expect(stored?.imageName).toBe("replacement.png");
        expect(typeof stored?.imageBlob).toBe("object");
      },
      { timeout: 1_000 },
    );
    expect(uploadCheckInImage).not.toHaveBeenCalled();
  });

  it.each([
    ["401", () => response({ ok: false, error: { code: "SESSION_EXPIRED", message: "session" }, requestId: "save" }, 401)],
    ["409", () => response({ ok: false, error: { code: "VERSION_CONFLICT", message: "conflict" }, requestId: "save" }, 409)],
    ["429", () => response({ ok: false, error: { code: "RATE_LIMITED", message: "slow down" }, requestId: "save" }, 429)],
    ["5xx", () => response({ ok: false, error: { code: "SERVICE_UNAVAILABLE", message: "later" }, requestId: "save" }, 503)],
    ["network failure", () => Promise.reject(new TypeError("network failed"))],
  ])("retains the local draft when a cloud save has a %s failure", async (_label, failedSave) => {
    const date = getTodayKey();
    await saveDraft({
      userId: "authenticated-subject",
      date,
      attention: "local fallback",
      sourceUrl: "",
      summary: "",
      inspiration: "",
      imageBlob: null,
      imageName: "",
      removeImage: false,
      baseVersion: 1,
      updatedAt: `${date}T00:00:00.000Z`,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (init?.method === "PUT") return failedSave();
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month" }));
        }
        if (path.includes("/api/checkins/stats?")) {
          return Promise.resolve(response({ ok: true, data: { totalCount: 0, currentStreak: 0, hasTodayRecord: false }, requestId: "stats" }));
        }
        if (path.includes("/api/checkins/")) {
          return Promise.resolve(response({ ok: true, data: record(date, "cloud"), requestId: "date" }));
        }
        return Promise.resolve(response({ ok: true, data: { profile: { id: "profile", displayName: "学习者", avatarKey: 1 } }, requestId: "profile" }));
      }),
    );

    render(
      <TestQueryProvider>
        <CheckInWorkspace initialDate={date} initialToday={date} userId="authenticated-subject" />
      </TestQueryProvider>,
    );

    await waitFor(() => expect(field<HTMLInputElement>("attention")).toHaveValue("cloud"));
    await userEvent.setup().type(field<HTMLInputElement>("attention"), " updated");
    await userEvent.setup().click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    expect(await loadDraft("authenticated-subject", date)).toMatchObject({ attention: "local fallback" });
  });

  it("deletes the local draft only after a confirmed cloud save", async () => {
    const date = getTodayKey();
    await saveDraft({
      userId: "authenticated-subject",
      date,
      attention: "local fallback",
      sourceUrl: "",
      summary: "",
      inspiration: "",
      imageBlob: null,
      imageName: "",
      removeImage: false,
      baseVersion: 1,
      updatedAt: `${date}T00:00:00.000Z`,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (init?.method === "PUT") {
          return Promise.resolve(response({ ok: true, data: record(date, "cloud updated", 2), requestId: "save" }));
        }
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month" }));
        }
        if (path.includes("/api/checkins/stats?")) {
          return Promise.resolve(response({ ok: true, data: { totalCount: 0, currentStreak: 0, hasTodayRecord: false }, requestId: "stats" }));
        }
        if (path.includes("/api/checkins/")) {
          return Promise.resolve(response({ ok: true, data: record(date, "cloud"), requestId: "date" }));
        }
        return Promise.resolve(response({ ok: true, data: { profile: { id: "profile", displayName: "学习者", avatarKey: 1 } }, requestId: "profile" }));
      }),
    );

    render(
      <TestQueryProvider>
        <CheckInWorkspace initialDate={date} initialToday={date} userId="authenticated-subject" />
      </TestQueryProvider>,
    );

    await waitFor(() => expect(field<HTMLInputElement>("attention")).toHaveValue("cloud"));
    await userEvent.setup().type(field<HTMLInputElement>("attention"), " updated");
    await userEvent.setup().click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(async () => expect(await loadDraft("authenticated-subject", date)).toBeUndefined());
  });

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

    const attention = screen.getByLabelText("今日知识主题");
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
    await userEvent.type(screen.getByLabelText("今日知识主题"), "今天学习了 RAG");
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
    const attention = screen.getByLabelText("今日知识主题");
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
    const attention = screen.getByLabelText("今日知识主题");
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
    const attention = screen.getByLabelText("今日知识主题");
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
    const attention = screen.getByLabelText("今日知识主题");
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
    const attention = screen.getByLabelText("今日知识主题");
    await waitFor(() => expect(attention).toHaveValue("缓存中的初版"));
    await user.type(attention, "，本地修改");
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(screen.getByText("请稍后再试")).toBeVisible());
    expect(screen.queryByRole("dialog", { name: "云端记录已更新" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("今日知识主题")).toHaveValue("缓存中的初版，本地修改");
    expect(screen.getByRole("button", { name: new RegExp(`${formatCalendarDate(date)}，已保存：缓存中的初版`) })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(screen.getByText("服务返回内容不正确，请稍后再试")).toBeVisible());
    expect(screen.queryByRole("dialog", { name: "云端记录已更新" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("今日知识主题")).toHaveValue("缓存中的初版，本地修改");
    expect(screen.getByRole("button", { name: new RegExp(`${formatCalendarDate(date)}，已保存：缓存中的初版`) })).toBeVisible();
  });

  it("celebrates when keeping local content retries an insert after the cloud record was deleted", async () => {
    const date = "2026-07-23";
    const initial = record(date, "原本的云端记录");
    let saves = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
        }
        if (init?.method === "PUT") {
          saves += 1;
          if (saves === 1) {
            return Promise.resolve(response({
              ok: false,
              error: {
                code: "VERSION_CONFLICT",
                message: "云端记录已被删除，请确认后重试",
                details: { current: null },
              },
              requestId: "delete-conflict-request",
            }, 409));
          }
          return Promise.resolve(response({
            ok: true,
            data: record(date, "保留本地后重新创建"),
            requestId: "insert-request",
          }));
        }
        if (path.endsWith(`/${date}`)) {
          return Promise.resolve(response({ ok: true, data: initial, requestId: "date-request" }));
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    renderWorkspace(date);
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toHaveValue("原本的云端记录"));
    await user.clear(screen.getByLabelText("今日知识主题"));
    await user.type(screen.getByLabelText("今日知识主题"), "保留本地后重新创建");
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await user.click(await screen.findByRole("button", { name: "保留本地内容" }));
    await user.click(screen.getByRole("button", { name: "保存修改" }));

    expect(await screen.findByText("这一天的学习收获已收下")).toBeVisible();
    expect(screen.queryByText("修改已保存到云端")).not.toBeInTheDocument();
  });

  it("uses edit feedback when keeping local content retries against a record created in the cloud", async () => {
    const date = "2026-07-23";
    const cloudRecord = record(date, "云端后来创建的记录", 2);
    let saves = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
        }
        if (init?.method === "PUT") {
          saves += 1;
          if (saves === 1) {
            return Promise.resolve(response({
              ok: false,
              error: {
                code: "VERSION_CONFLICT",
                message: "云端记录已更新，请确认后重试",
                details: { current: cloudRecord },
              },
              requestId: "create-conflict-request",
            }, 409));
          }
          return Promise.resolve(response({
            ok: true,
            data: { ...cloudRecord, attention: "保留本地后覆盖云端" },
            requestId: "update-request",
          }));
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    renderWorkspace(date);
    const user = userEvent.setup();
    await waitForEditorReady();
    await user.type(screen.getByLabelText("今日知识主题"), "保留本地后覆盖云端");
    await user.click(screen.getByRole("button", { name: /完成打卡/ }));
    await user.click(await screen.findByRole("button", { name: "保留本地内容" }));
    await user.click(screen.getByRole("button", { name: /完成打卡/ }));

    expect(await screen.findByText("修改已保存到云端")).toBeVisible();
    expect(screen.queryByText("这一天的学习收获已收下")).not.toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toHaveValue("云端初版"));
    await user.click(screen.getByRole("button", { name: "替换测试图片" }));
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await user.click(await screen.findByRole("button", { name: "保留本地内容" }));
    await user.click(screen.getByRole("button", { name: "还原未保存的修改" }));

    await waitFor(() => expect(deleteCheckInImage).toHaveBeenCalledWith("checkin-images/user/pending.png"));
    expect(screen.getByLabelText("今日知识主题")).toBeDisabled();
    expect(screen.getByLabelText("添加图片笔记")).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "还原未保存的修改" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /今日/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /7月24日/ })).toBeDisabled();
    expect(container.querySelector(".checkin-form")).toHaveAttribute("aria-busy", "true");

    cleanup.resolve();

    await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toHaveValue("云端初版"));
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
    await user.type(screen.getByLabelText("今日知识主题"), "待放弃的内容");
    await user.click(screen.getByRole("button", { name: "替换测试图片" }));
    await user.click(screen.getByRole("button", { name: /完成打卡/ }));
    await user.click(await screen.findByRole("button", { name: "保留本地内容" }));
    await user.click(screen.getByRole("button", { name: /7月24日/ }));
    await user.click(screen.getByRole("button", { name: "放弃修改" }));

    await waitFor(() => expect(deleteCheckInImage).toHaveBeenCalledWith("checkin-images/user/pending.png"));
    expect(screen.getByRole("button", { name: "保存并切换" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "放弃修改" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    expect(screen.getByText(formatDate(date), { selector: ".editor-date" })).toBeVisible();

    cleanup.resolve();

    await waitFor(() => expect(screen.getByText(formatDate("2026-07-24"), { selector: ".editor-date" })).toBeVisible());
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
    await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toHaveValue("云端初版"));
    await user.click(screen.getByRole("button", { name: "替换测试图片" }));
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await user.click(await screen.findByRole("button", { name: "载入云端版本" }));

    await waitFor(() => expect(deleteCheckInImage).toHaveBeenCalledWith("checkin-images/user/pending.png"));
    expect(screen.getByRole("button", { name: "保留本地内容" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "载入云端版本" })).toBeDisabled();
    expect(screen.getByLabelText("今日知识主题")).toHaveValue("云端初版");

    cleanup.resolve();

    await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toHaveValue("云端新版本"));
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
    expect(screen.getByLabelText("今日知识主题")).toBeDisabled();
    expect(screen.getByRole("button", { name: "重试" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toBeEnabled());
    expect(screen.getByLabelText("今日知识主题")).toHaveValue("重试后的云端内容");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps account controls available while the selected record has a session error", async () => {
    const date = "2026-07-23";
    const profile = { id: "profile-1", email: "learner@example.com", avatarKey: 1, displayName: "学习者", onboardingCompleted: true };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
        }
        if (path.startsWith("/api/checkins/stats?")) {
          return Promise.resolve(response({
            ok: true,
            data: { totalCount: 0, currentStreak: 0, hasTodayRecord: false },
            requestId: "stats-request",
          }));
        }
        if (path === "/api/me") {
          return Promise.resolve(response({ ok: true, data: { profile }, requestId: "profile-request" }));
        }
        if (path.endsWith(`/${date}`)) {
          return Promise.resolve(response({
            ok: false,
            error: { code: "SESSION_EXPIRED", message: "登录已失效，请重新登录" },
            requestId: "expired-request",
          }, 401));
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    render(
      <TestQueryProvider>
        <CheckInWorkspace initialDate={date} initialProfile={profile} initialToday={getTodayKey()} />
      </TestQueryProvider>,
    );
    const user = userEvent.setup();

    await screen.findByRole("alert");
    const accountTrigger = screen.getByRole("button", { name: "打开账户菜单" });
    expect(accountTrigger).toBeEnabled();
    await user.click(accountTrigger);
    await user.click(screen.getByRole("menuitem", { name: "编辑资料" }));
    await user.clear(screen.getByLabelText("名称"));
    await user.type(screen.getByLabelText("名称"), "未保存的资料名");

    expect(screen.getByLabelText("名称")).toHaveValue("未保存的资料名");
    expect(screen.getByRole("button", { name: "关闭资料设置" })).toBeEnabled();
  });

  it("keeps cancel and discard available while a dirty record is revalidating", async () => {
    const date = "2026-07-23";
    const initial = record(date, "云端初版");
    const refresh = deferred<Response>();
    let reads = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
        }
        if (path.endsWith(`/${date}`)) {
          reads += 1;
          return reads === 1
            ? Promise.resolve(response({ ok: true, data: initial, requestId: "initial-request" }))
            : refresh.promise;
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    const { queryClient } = renderWorkspaceWithCachedRecord(date, initial);
    const user = userEvent.setup();
    await waitForEditorReady();
    await user.type(screen.getByLabelText("今日知识主题"), "，本地修改");

    act(() => {
      void queryClient.invalidateQueries({ queryKey: checkInKeys.date(date) });
    });
    await waitFor(() => expect(reads).toBe(2));
    expect(screen.getByLabelText("今日知识主题")).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "退出当前用户" }));

    expect(screen.getByRole("button", { name: "保存并退出" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "放弃修改并退出" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("dialog", { name: "退出前还有修改没有保存" })).not.toBeInTheDocument();

    refresh.resolve(response({ ok: true, data: initial, requestId: "refresh-request" }));
    await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toBeEnabled());
  });

  it("allows discard-and-logout after a dirty record revalidation error", async () => {
    const date = "2026-07-23";
    const initial = record(date, "云端初版");
    let reads = 0;
    let logoutRequests = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
        }
        if (path === "/api/auth/logout" && init?.method === "POST") {
          logoutRequests += 1;
          return Promise.resolve(response({
            ok: false,
            error: { code: "SERVICE_UNAVAILABLE", message: "暂时无法退出" },
            requestId: "logout-request",
          }, 503));
        }
        if (path.endsWith(`/${date}`)) {
          reads += 1;
          return reads === 1
            ? Promise.resolve(response({ ok: true, data: initial, requestId: "initial-request" }))
            : Promise.resolve(response({
                ok: false,
                error: { code: "SESSION_EXPIRED", message: "登录已失效，请重新登录" },
                requestId: "expired-request",
              }, 401));
        }
        return Promise.resolve(missingCheckIn());
      }),
    );

    const { queryClient } = renderWorkspaceWithCachedRecord(date, initial);
    const user = userEvent.setup();
    await waitForEditorReady();
    await user.type(screen.getByLabelText("今日知识主题"), "，准备放弃");

    act(() => {
      void queryClient.invalidateQueries({ queryKey: checkInKeys.date(date) });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("登录已失效，请重新登录");
    await user.click(screen.getByRole("button", { name: "退出当前用户" }));

    expect(screen.getByRole("button", { name: "保存并退出" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "放弃修改并退出" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "取消" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "放弃修改并退出" }));

    await waitFor(() => expect(logoutRequests).toBe(1));
    expect(await screen.findByText("暂时无法退出")).toBeVisible();
  });

  it("restores the latest cached record when candidate cleanup finishes before a failed logout", async () => {
    const date = "2026-07-23";
    const initial = record(date, "云端初版");
    const conflictRecord = record(date, "冲突时云端版本", 2);
    const refreshedRecord = record(date, "清理期间刷新的云端版本", 3);
    const cleanupRequest = deferred<void>();
    let logoutRequests = 0;
    vi.mocked(uploadCheckInImage).mockResolvedValue("checkin-images/user/pending.png");
    vi.mocked(deleteCheckInImage).mockReturnValue(cleanupRequest.promise);
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        if (path.includes("/api/checkins?month=")) {
          return Promise.resolve(response({ ok: true, data: [], requestId: "month-request" }));
        }
        if (path === "/api/auth/logout" && init?.method === "POST") {
          logoutRequests += 1;
          return Promise.resolve(response({
            ok: false,
            error: { code: "SERVICE_UNAVAILABLE", message: "暂时无法退出" },
            requestId: "logout-request",
          }, 503));
        }
        if (init?.method === "PUT") {
          return Promise.resolve(response({
            ok: false,
            error: {
              code: "VERSION_CONFLICT",
              message: "云端记录已更新，请确认后重试",
              details: { current: conflictRecord },
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

    const { queryClient } = renderWorkspaceWithCachedRecord(date, initial);
    const user = userEvent.setup();
    await waitForEditorReady();
    await user.type(screen.getByLabelText("今日知识主题"), "，本地修改");
    await user.click(screen.getByRole("button", { name: "替换测试图片" }));
    await user.click(screen.getByRole("button", { name: "保存修改" }));
    await user.click(await screen.findByRole("button", { name: "保留本地内容" }));
    await user.click(screen.getByRole("button", { name: "退出当前用户" }));
    await user.click(screen.getByRole("button", { name: "放弃修改并退出" }));

    await waitFor(() => {
      expect(deleteCheckInImage).toHaveBeenCalledWith("checkin-images/user/pending.png");
    });
    act(() => {
      queryClient.setQueryData(checkInKeys.date(date), refreshedRecord);
    });
    cleanupRequest.resolve();

    await waitFor(() => expect(logoutRequests).toBe(1));
    expect(await screen.findByText("暂时无法退出")).toBeVisible();
    await waitFor(() => {
      expect(screen.getByLabelText("今日知识主题")).toHaveValue("清理期间刷新的云端版本");
    });
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
    await user.type(screen.getByLabelText("今日知识主题"), "还没保存的内容");
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
    await user.type(screen.getByLabelText("今日知识主题"), "等待确认的 Today 切换");
    await user.click(screen.getByRole("button", { name: /今日/ }));

    expect(screen.getByRole("dialog", { name: "尚未保存" })).toBeVisible();
    expect(screen.getByRole("heading", { name: formatMonth(initialMonth) })).toBeVisible();
    expect(screen.getByText(formatDate(initialDate), { selector: ".editor-date" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.getByRole("heading", { name: formatMonth(initialMonth) })).toBeVisible();
    expect(screen.getByText(formatDate(initialDate), { selector: ".editor-date" })).toBeVisible();
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
    await user.type(screen.getByLabelText("今日知识主题"), "浏览后仍未保存");
    await user.click(screen.getByRole("button", { name: "下个月" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: formatMonth(browsedMonth) })).toBeVisible());
    await user.click(screen.getByRole("button", { name: new RegExp(formatCalendarDate(targetDate)) }));

    expect(screen.getByRole("dialog", { name: "尚未保存" })).toBeVisible();
    expect(screen.getByRole("heading", { name: formatMonth(browsedMonth) })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.getByRole("heading", { name: formatMonth(browsedMonth) })).toBeVisible();
    expect(screen.getByText(formatDate(initialDate), { selector: ".editor-date" })).toBeVisible();
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
    await user.type(screen.getByLabelText("今日知识主题"), "保存后切换");
    await user.click(screen.getByRole("button", { name: /今日/ }));
    await user.click(screen.getByRole("button", { name: "保存并切换" }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: formatMonth(todayMonth) })).toBeVisible();
      expect(screen.getByText(formatDate(today), { selector: ".editor-date" })).toBeVisible();
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
    await user.type(screen.getByLabelText("今日知识主题"), "放弃后切换");
    await user.click(screen.getByRole("button", { name: /今日/ }));
    await user.click(screen.getByRole("button", { name: "放弃修改" }));

    await waitFor(() => expect(screen.getByRole("heading", { name: formatMonth(todayMonth) })).toBeVisible());
    expect(screen.getByLabelText("今日知识主题")).toHaveValue("");
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
    await user.type(screen.getByLabelText("今日知识主题"), "待保存内容");
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
    await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toHaveValue("云端初版"));
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
          initialProfile={{ id: "profile-1", email: "learner@example.com", avatarKey: 1, displayName: "学习者", onboardingCompleted: true }}
        />
      </TestQueryProvider>,
    );
    const user = userEvent.setup();
    const attention = screen.getByLabelText("今日知识主题");
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
    const attention = screen.getByLabelText("今日知识主题");
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
    const attention = screen.getByLabelText("今日知识主题");
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
    await user.type(screen.getByLabelText("今日知识主题"), "保留候选图片");
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
    await user.type(screen.getByLabelText("今日知识主题"), "可能已经写入云端");
    await user.click(screen.getByRole("button", { name: "替换测试图片" }));
    await user.click(screen.getByRole("button", { name: /完成打卡/ }));
    await waitFor(() => {
      expect(screen.getByText("网络连接失败，请检查网络后重试")).toBeVisible();
    });

    await user.click(screen.getByRole("button", { name: "还原未保存的修改" }));

    await waitFor(() => expect(screen.getByLabelText("今日知识主题")).toHaveValue(""));
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
    await user.type(screen.getByLabelText("今日知识主题"), "明确拒绝");
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

    expect(screen.getByText(formatDate(browserToday), { selector: ".editor-date" })).toBeVisible();
    expect(screen.getByRole("button", { name: new RegExp(`${formatCalendarDate(browserToday)}.*今天`) })).toHaveClass("today");
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
    const attention = screen.getByLabelText("今日知识主题");
    expect(attention).toBeEnabled();
    fireEvent.change(attention, { target: { value: "跨过午夜也不能丢" } });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(nextMidnight.getTime() - beforeMidnight.getTime() + 1);
    });

    expect(attention).toHaveValue("跨过午夜也不能丢");
    expect(screen.getByText(formatDate(oldToday), { selector: ".editor-date" })).toBeVisible();
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

it("returns the header knowledge entry to the library after confirming unsaved narrative edits", async () => {
  const date = getTodayKey();
  const savedDates = ["2026-09-01", "2026-09-02"];
  const narrative = { id: "library-entry", title: "学习脉络", status: "succeeded", dates: savedDates, question: "", error: null,
    createdAt: "2026-09-10T08:00:00Z", updatedAt: "2026-09-10T08:00:00Z", changedDates: [],
    sources: savedDates.map(date => ({ date, attention: "知识", summary: "小结", inspiration: "", version: 1, sourceUrl: "", hasImage: false })),
    result: { title: "学习脉络", overview: "初始理解", nodes: savedDates.map(date => ({ date, label: "节点", takeaway: "理解" })),
      connections: [{ fromDate: savedDates[0], toDate: savedDates[1], relation: "递进", explanation: "逐渐深入" }],
      sections: [{ title: "叙事", body: "正文", sourceDates: savedDates }], framework: [{ title: "框架", body: "正文", sourceDates: savedDates }], gaps: [], nextSteps: ["继续学习"] } };
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const path = String(input);
    if (path === "/api/knowledge-narratives") return Promise.resolve(response({ ok: true, data: [narrative], requestId: "library" }));
    if (path === "/api/knowledge-narratives/library-entry") return Promise.resolve(response({ ok: true, data: narrative, requestId: "detail" }));
    if (path.includes("/api/checkins?month=")) return Promise.resolve(response({ ok: true, data: [], requestId: "list" }));
    if (path.startsWith("/api/checkins/stats")) return Promise.resolve(response({ ok: true, data: { totalCount: 0, currentStreak: 0, hasTodayRecord: false }, requestId: "stats" }));
    if (path === "/api/me") return Promise.resolve(response({ ok: true, data: { profile: null }, requestId: "profile" }));
    return Promise.resolve(missingCheckIn());
  }));
  renderWorkspace(date); const user = userEvent.setup(); await waitForEditorReady();
  await user.click(screen.getByRole("button", { name: "串联知识" }));
  await user.click(await screen.findByRole("button", { name: "编辑 学习脉络" }));
  await user.type(await screen.findByLabelText("总览"), "尚未保存");
  await user.click(screen.getByRole("button", { name: "串联知识" }));
  expect(screen.getByRole("dialog", { name: "放弃未保存的修改？" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "继续编辑" }));
  expect(screen.getByLabelText("总览")).toHaveValue("初始理解尚未保存");
  for (const name of ["开始今日打卡", "退出当前用户"]) {
    await user.click(screen.getByRole("button", { name }));
    expect(screen.getByRole("dialog", { name: "放弃未保存的修改？" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect(screen.getByLabelText("总览")).toHaveValue("初始理解尚未保存");
  }
  await user.click(screen.getByRole("button", { name: "串联知识" }));
  await user.click(screen.getByRole("button", { name: "放弃修改" }));
  expect(await screen.findByRole("region", { name: "已保存的脉络" })).toBeVisible();
  expect(screen.queryByRole("form", { name: "编辑知识脉络" })).not.toBeInTheDocument();
});
