import { apiRequest, ApiError } from './client';
import type { MemoryRecord, PersistentGathering, RewardSummary } from '../engagementTypes';

export type MemoryType = MemoryRecord['memoryType'];
export type MemoryVisibility = MemoryRecord['visibility'];

export const MAX_MEMORY_UPLOAD_BYTES = 15 * 1024 * 1024;

export const MEMORY_MEDIA_TYPES: Readonly<Record<Exclude<MemoryType, 'note'>, readonly string[]>> = {
  photo: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4'],
  audio: ['audio/mpeg', 'audio/mp4', 'audio/webm']
};

export interface CreateMemoryDraft {
  familyId: string;
  title: string;
  note?: string;
  memoryType: MemoryType;
  visibility: MemoryVisibility;
  selectedMemberIds?: string[];
  aiProcessingAllowed?: boolean;
  capturedAt: string;
}

export interface CreateMemoryRequest {
  familyId: string;
  title: string;
  note?: string;
  memoryType: MemoryType;
  visibility: MemoryVisibility;
  selectedMemberIds: string[];
  aiProcessingAllowed: boolean;
  capturedAt: string;
}

export interface FileLike {
  size: number;
  type: string;
}

export interface MemoryUploadProgress {
  loaded: number;
  total: number;
  percent: number;
}

export function buildCreateMemoryRequest(draft: CreateMemoryDraft): CreateMemoryRequest {
  const note = draft.note?.trim();
  return {
    familyId: draft.familyId,
    title: draft.title.trim(),
    ...(note ? { note } : {}),
    memoryType: draft.memoryType,
    visibility: draft.visibility,
    selectedMemberIds: draft.visibility === 'selected'
      ? [...new Set(draft.selectedMemberIds ?? [])]
      : [],
    aiProcessingAllowed: draft.aiProcessingAllowed === true,
    capturedAt: draft.capturedAt
  };
}

export function validateMemoryFile(memoryType: MemoryType, file?: FileLike | null): string | null {
  if (memoryType === 'note') return null;
  if (!file) return `Choose a ${memoryType} file.`;
  if (file.size <= 0) return 'Choose a non-empty media file.';
  if (file.size > MAX_MEMORY_UPLOAD_BYTES) return 'Media must be 15 MB or smaller.';
  if (!MEMORY_MEDIA_TYPES[memoryType].includes(file.type.toLowerCase())) {
    const supported = MEMORY_MEDIA_TYPES[memoryType].map(type => type.replace(/^.*\//, '').toUpperCase()).join(', ');
    return `This file type is not supported. Choose ${supported}.`;
  }
  return null;
}

export function validateMemoryDraft(draft: CreateMemoryDraft, file?: FileLike | null): string | null {
  if (draft.title.trim().length < 2) return 'Add a title with at least 2 characters.';
  if (draft.memoryType === 'note' && !draft.note?.trim()) return 'Write the memory before saving it.';
  if (draft.visibility === 'selected' && new Set(draft.selectedMemberIds ?? []).size === 0) {
    return 'Select at least one family member who may view this memory.';
  }
  if (!draft.capturedAt || Number.isNaN(Date.parse(draft.capturedAt))) return 'Choose a valid date and time.';
  return validateMemoryFile(draft.memoryType, file);
}

export const memoriesRewardsApi = {
  listGatherings: (familyId: string) => (
    apiRequest<{ gatherings: PersistentGathering[] }>(`/api/families/${encodeURIComponent(familyId)}/gatherings`)
  ),

  listMemories: (familyId: string) => (
    apiRequest<{ memories: MemoryRecord[] }>(`/api/families/${encodeURIComponent(familyId)}/memories`)
  ),

  createMemory: (gatheringId: string, draft: CreateMemoryDraft) => (
    apiRequest<{ memory: MemoryRecord; uploadPath?: string }>(
      `/api/gatherings/${encodeURIComponent(gatheringId)}/memories`,
      { method: 'POST', body: JSON.stringify(buildCreateMemoryRequest(draft)) }
    )
  ),

  deleteMemory: (memoryId: string) => (
    apiRequest<void>(`/api/memories/${encodeURIComponent(memoryId)}`, { method: 'DELETE' })
  ),

  getRewards: (familyId: string) => (
    apiRequest<RewardSummary>(`/api/families/${encodeURIComponent(familyId)}/rewards`)
  ),

  redeemReward: (familyId: string, offerId: string) => (
    apiRequest<{ redemption: { id: string; status: 'pending'; pointsSpent: number } }>(
      `/api/families/${encodeURIComponent(familyId)}/rewards/${encodeURIComponent(offerId)}/redeem`,
      { method: 'POST' }
    )
  )
};

function readUploadError(xhr: XMLHttpRequest): ApiError {
  const response = xhr.response as { error?: { code?: string; message?: string; issues?: unknown } } | null;
  return new ApiError(
    response?.error?.message || `Media upload failed (${xhr.status || 'network error'}).`,
    xhr.status,
    response?.error?.code,
    response?.error?.issues
  );
}

export function uploadMemoryMedia(
  uploadPath: string,
  file: File,
  memoryType: Exclude<MemoryType, 'note'>,
  onProgress?: (progress: MemoryUploadProgress) => void
): Promise<MemoryRecord> {
  const validationError = validateMemoryFile(memoryType, file);
  if (validationError) return Promise.reject(new ApiError(validationError, 0, 'INVALID_MEDIA'));
  if (!/^\/api\/memories\/[0-9a-f-]+\/media$/i.test(uploadPath)) {
    return Promise.reject(new ApiError('The server returned an invalid media upload path.', 0, 'INVALID_UPLOAD_PATH'));
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadPath);
    xhr.withCredentials = true;
    xhr.responseType = 'json';
    xhr.timeout = 120_000;
    xhr.setRequestHeader('Content-Type', file.type.toLowerCase());
    xhr.upload.onprogress = event => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress?.({
        loaded: event.loaded,
        total: event.total,
        percent: Math.min(100, Math.round((event.loaded / event.total) * 100))
      });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const payload = xhr.response as { memory?: MemoryRecord } | null;
        if (payload?.memory) {
          onProgress?.({ loaded: file.size, total: file.size, percent: 100 });
          resolve(payload.memory);
          return;
        }
      }
      reject(readUploadError(xhr));
    };
    xhr.onerror = () => reject(new ApiError('The media upload could not reach the server.', 0, 'NETWORK_ERROR'));
    xhr.ontimeout = () => reject(new ApiError('The media upload timed out. Try again.', 0, 'UPLOAD_TIMEOUT'));
    xhr.onabort = () => reject(new ApiError('The media upload was cancelled.', 0, 'UPLOAD_ABORTED'));
    xhr.send(file);
  });
}

export async function fetchMemoryMedia(memoryId: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(`/api/memories/${encodeURIComponent(memoryId)}/media`, {
      credentials: 'same-origin',
      cache: 'no-store'
    });
  } catch {
    throw new ApiError('The memory media could not reach the server.', 0, 'NETWORK_ERROR');
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } };
    throw new ApiError(
      payload.error?.message || `Memory media failed to load (${response.status}).`,
      response.status,
      payload.error?.code
    );
  }
  return URL.createObjectURL(await response.blob());
}
