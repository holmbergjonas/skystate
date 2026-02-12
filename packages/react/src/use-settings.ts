import { useEffect, useState } from "react";
import type { SkyStateConfig, StateEnvelope } from "@skystate/core";
import { SkyStateError } from "@skystate/core";
import { fetchSettings } from "@skystate/core";

export interface UseSettingsResult<T> {
  data: StateEnvelope<T> | null;
  loading: boolean;
  error: SkyStateError | null;
}

export function useSettings<T = unknown>(config: SkyStateConfig): UseSettingsResult<T> {
  const [data, setData] = useState<StateEnvelope<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<SkyStateError | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    setLoading(true);
    setError(null);

    fetchSettings<T>({ ...config, signal: controller.signal })
      .then((envelope) => {
        setData(envelope);
        setLoading(false);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof SkyStateError ? err : new SkyStateError("unknown", String(err)));
        setLoading(false);
      });

    return () => controller.abort();
  }, [config.apiUrl, config.projectSlug, config.environmentSlug]);

  return { data, loading, error };
}
