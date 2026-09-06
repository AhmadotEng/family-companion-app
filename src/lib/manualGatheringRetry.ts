export interface ManualGatheringRetryState {
  version: 1;
  idempotencyKey: string;
  uncertainCreateOutcome: true;
}

const STORAGE_PREFIX = 'family-companion:manual-gathering-retry:v1:';
const SCOPE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]{7,127}$/;

function scopedStorageKey(currentUserId: string, familyId: string): string | null {
  if (!SCOPE_ID_PATTERN.test(currentUserId) || !SCOPE_ID_PATTERN.test(familyId)) return null;
  return `${STORAGE_PREFIX}${currentUserId}:${familyId}`;
}

function browserSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isManualGatheringRetryState(value: unknown): value is ManualGatheringRetryState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return keys.length === 3
    && keys[0] === 'idempotencyKey'
    && keys[1] === 'uncertainCreateOutcome'
    && keys[2] === 'version'
    && record.version === 1
    && record.uncertainCreateOutcome === true
    && typeof record.idempotencyKey === 'string'
    && IDEMPOTENCY_KEY_PATTERN.test(record.idempotencyKey);
}

export function readManualGatheringRetryState(
  currentUserId: string,
  familyId: string,
): ManualGatheringRetryState | null {
  const storage = browserSessionStorage();
  const storageKey = scopedStorageKey(currentUserId, familyId);
  if (!storage || !storageKey) return null;

  try {
    const stored = storage.getItem(storageKey);
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    if (isManualGatheringRetryState(parsed)) return parsed;
    storage.removeItem(storageKey);
  } catch {
    try {
      storage.removeItem(storageKey);
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  }
  return null;
}

export function writeManualGatheringRetryState(
  currentUserId: string,
  familyId: string,
  idempotencyKey: string,
): boolean {
  const storage = browserSessionStorage();
  const storageKey = scopedStorageKey(currentUserId, familyId);
  if (!storage || !storageKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) return false;

  const state: ManualGatheringRetryState = {
    version: 1,
    idempotencyKey,
    uncertainCreateOutcome: true,
  };
  try {
    storage.setItem(storageKey, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearManualGatheringRetryState(currentUserId: string, familyId: string): void {
  const storage = browserSessionStorage();
  const storageKey = scopedStorageKey(currentUserId, familyId);
  if (!storage || !storageKey) return;
  try {
    storage.removeItem(storageKey);
  } catch {
    // Keep logout and planner cleanup usable when storage access is blocked.
  }
}

export function clearAllManualGatheringRetryStates(): void {
  const storage = browserSessionStorage();
  if (!storage) return;
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const storageKey = storage.key(index);
      if (storageKey?.startsWith(STORAGE_PREFIX)) storage.removeItem(storageKey);
    }
  } catch {
    // Logout must continue even if storage access is blocked.
  }
}
