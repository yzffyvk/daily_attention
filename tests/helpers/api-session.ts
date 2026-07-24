export class ApiSession {
  private cookie = "";

  constructor(
    private readonly baseUrl = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3100",
    private readonly defaultHeaders: HeadersInit = {},
  ) {}

  async request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...this.defaultHeaders,
        ...init.headers,
      },
    });
    const nextCookies = response.headers.getSetCookie();
    if (nextCookies.length > 0) {
      this.cookie = nextCookies.map((value) => value.split(";", 1)[0]).join("; ");
    }
    return {
      status: response.status,
      body: await response.json(),
      headers: response.headers,
    };
  }

  post(path: string, body: unknown) {
    return this.request(path, { method: "POST", body: JSON.stringify(body) });
  }
}
