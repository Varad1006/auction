import type { ActionInput, ActionName } from "@/server/actions";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Calls a server action. Throws ApiError with the server's reason on failure. */
export async function callAction<N extends ActionName>(name: N, input: ActionInput<N>): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`/api/actions/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new ApiError(0, "network", "Network error: check your connection");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) {
    throw new ApiError(res.status, body?.code ?? "error", body?.message ?? `Request failed (${res.status})`);
  }
  return body.data;
}
