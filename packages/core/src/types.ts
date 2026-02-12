export interface Version {
  major: number;
  minor: number;
  patch: number;
}

export interface ConfigEnvelope {
  version: Version;
  lastModified: string;
  config: unknown;
}

/** @deprecated Use ConfigEnvelope. Kept for backward compatibility during migration. */
export interface StateEnvelope<T = unknown> {
  version: Version;
  lastModified: string;
  state: T;
}

export interface SkyStateConfig {
  apiUrl: string;
  projectSlug: string;
  environmentSlug: string;
}

export interface ConfigStoreOptions {
  apiUrl: string;
  projectSlug: string;
  environmentSlug: string;
  initialConfig?: unknown;
  clientHeader?: string;
}
