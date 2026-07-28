import type { ReactNode } from "react";

export function AuthCard({
  step,
  title,
  description,
  children,
}: {
  step: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="login-page">
      <section className="login-shell">
        <div className="login-brand">
          <div className="auth-brand-mark" aria-hidden="true">A</div>
          <div>
            <p className="eyebrow">AI LEARNING JOURNAL</p>
            <h1>
              今天你<span>attention</span>了吗？
            </h1>
            <p>给每天的学习留一个名字，也给自己留一个位置。</p>
          </div>
          <div aria-hidden="true" className="auth-signal">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
        <section className="login-panel" aria-labelledby="auth-card-title">
          <div className="login-panel-heading">
            <span className="login-step">{step}</span>
            <div>
              <h2 id="auth-card-title">{title}</h2>
              <p>{description}</p>
            </div>
          </div>
          {children}
        </section>
      </section>
    </main>
  );
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; field?: string } };

export async function postAuth<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return {
      ok: false,
      error: { message: "网络连接失败，请检查网络后重试" },
    };
  }
  try {
    const result = await response.json() as ApiResult<T> & {
      error?: { message?: string; details?: { field?: string } };
    };
    if (!result.ok) {
      return {
        ok: false,
        error: {
          message: result.error?.message || "服务暂时不可用，请稍后再试",
          field: result.error?.details?.field,
        },
      };
    }
    return result;
  } catch {
    return { ok: false, error: { message: "服务暂时不可用，请稍后再试" } };
  }
}
