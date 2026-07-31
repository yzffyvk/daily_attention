import "server-only";

export type SafeLogValue = string | number | boolean | null | undefined;

const forbiddenLogFields = new Set([
  "body",
  "email",
  "password",
  "recoverycode",
  "token",
  "secret",
  "signedurl",
  "sourceurl",
  "reasoningcontent",
  "stack",
]);

function normalizedLogField(field: string) {
  return field.replaceAll(/[_-]/gu, "").toLowerCase();
}

function assertSafeLogFields(fields: Record<string, SafeLogValue>) {
  for (const [field, value] of Object.entries(fields)) {
    if (forbiddenLogFields.has(normalizedLogField(field))) {
      throw new Error(`Unsafe log field: ${field}`);
    }
    const valueType = typeof value;
    if (
      value !== null
      && value !== undefined
      && valueType !== "string"
      && valueType !== "number"
      && valueType !== "boolean"
    ) {
      throw new Error(`Unsafe log value: ${field}`);
    }
  }
}

export function operationalErrorFields(error: unknown): {
  errorType: string;
  errorCode: string;
} {
  const candidate = error && typeof error === "object"
    ? error as { code?: unknown }
    : undefined;
  return {
    errorType: error instanceof AggregateError
      ? "AggregateError"
      : error instanceof Error
        ? error.name
        : typeof error,
    errorCode: typeof candidate?.code === "string"
      ? candidate.code
      : error instanceof Error && /^[A-Z][A-Z0-9_]+$/u.test(error.message)
        ? error.message
        : "INTERNAL_ERROR",
  };
}

export function logServerError(
  event: string,
  fields: Record<string, SafeLogValue>,
) {
  assertSafeLogFields(fields);
  console.error("server_error", { event, ...fields });
}
