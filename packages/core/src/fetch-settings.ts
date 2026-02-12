import type { SkyStateConfig, StateEnvelope } from "./types.js";
import { SkyStateError } from "./error.js";

export interface FetchSettingsOptions extends SkyStateConfig {
  signal?: AbortSignal;
}

export async function fetchSettings<T = unknown>(
  options: FetchSettingsOptions,
): Promise<StateEnvelope<T>> {
  const { apiUrl, projectSlug, environmentSlug, signal } = options;
  const url = `${apiUrl.replace(/\/$/, "")}/project/${projectSlug}/config/${environmentSlug}`;

  const response = await fetch(url, { signal });

  if (!response.ok) {
    if (response.status === 404) {
      throw new SkyStateError("not_found", "Project or environment not found", 404);
    }
    if (response.status === 400) {
      const body = await response.json();
      throw new SkyStateError(body.error, body.message, 400);
    }
    throw new SkyStateError("unknown", `Unexpected response: ${response.status}`, response.status);
  }

  return response.json();
}
