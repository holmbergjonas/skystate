import { ApiError } from '@/lib/api-error';
import type { Version } from '@/api/types';

export type BumpType = 'major' | 'minor' | 'patch';

export function computeNextVersion(
  current: Version,
  bumpType: BumpType,
): Version {
  switch (bumpType) {
    case 'major':
      return { major: current.major + 1, minor: 0, patch: 0 };
    case 'minor':
      return { major: current.major, minor: current.minor + 1, patch: 0 };
    case 'patch':
      return { major: current.major, minor: current.minor, patch: current.patch + 1 };
  }
}

export function getPushErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 402) {
      const body = err.errorBody as { code?: string } | null;
      if (body?.code === 'LIMIT_STORAGE') {
        return 'You\'ve exceeded your storage limit. Upgrade your plan to continue saving state.';
      }
      return 'Limit reached. Please upgrade your plan.';
    }
    if (err.status === 404) {
      return 'Version conflict \u2014 another update was pushed. Please try again.';
    }
    return `Failed to push update (${err.status})`;
  }
  if (err instanceof TypeError) {
    return 'Network error \u2014 check your connection and try again.';
  }
  return 'An unexpected error occurred. Please try again.';
}
