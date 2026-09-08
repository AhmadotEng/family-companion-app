import {
  ApiFamilyMember,
  AuthSession,
  FamilyContext,
  FamilyRelationship,
  LocationPrecision,
  LocationVisibility,
  RelationshipType,
  SafeLocation
} from '../types';

type ErrorEnvelope = {
  error?: {
    code?: string;
    message?: string;
    issues?: unknown;
  };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly issues?: unknown;

  constructor(message: string, status: number, code?: string, issues?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
      credentials: 'same-origin'
    });
  } catch {
    throw new ApiError('The AILAH server is unavailable. Check that the local server is running.', 0, 'NETWORK_ERROR');
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json().catch(() => ({}))
    : {};

  if (!response.ok) {
    const envelope = payload as ErrorEnvelope;
    throw new ApiError(
      envelope.error?.message || `Request failed (${response.status}).`,
      response.status,
      envelope.error?.code,
      envelope.error?.issues
    );
  }

  return payload as T;
}

export const authApi = {
  me: () => apiRequest<AuthSession>('/api/auth/me'),
  login: (input: { email: string; password: string }) => apiRequest<AuthSession>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(input)
  }),
  register: (input: { email: string; password: string; displayName: string; familyName: string }) => apiRequest<AuthSession>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(input)
  }),
  logout: () => apiRequest<void>('/api/auth/logout', { method: 'POST' })
};

export const familyApi = {
  getContext: (familyId: string) => apiRequest<FamilyContext>(`/api/families/${encodeURIComponent(familyId)}/context`),

  createMember: (
    familyId: string,
    input: {
      displayName: string;
      birthDate?: string;
      phone?: string;
      email?: string;
      interests?: string[];
      notes?: string;
      photoUrl?: string;
      relationship?: {
        relatedMemberId: string;
        type: RelationshipType;
        direction?: 'source' | 'target';
      };
      relationships?: Array<{
        relatedMemberId: string;
        type: RelationshipType;
        direction?: 'source' | 'target';
      }>;
      location?: {
        emirate?: string;
        city?: string;
        precision: Exclude<LocationPrecision, 'exact'>;
        visibility?: LocationVisibility;
      };
    }
  ) => apiRequest<{ member: ApiFamilyMember; relationship?: FamilyRelationship; relationships: FamilyRelationship[]; safeLocation?: SafeLocation }>(
    `/api/families/${encodeURIComponent(familyId)}/members`,
    { method: 'POST', body: JSON.stringify(input) }
  ),

  updateMember: (memberId: string, input: {
    displayName?: string;
    birthDate?: string | null;
    phone?: string | null;
    email?: string | null;
    interests?: string[];
    notes?: string | null;
    photoUrl?: string | null;
  }) => (
    apiRequest<{ member: ApiFamilyMember }>(`/api/family-members/${encodeURIComponent(memberId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input)
    })
  ),

  deleteMember: (memberId: string) => apiRequest<void>(`/api/family-members/${encodeURIComponent(memberId)}`, { method: 'DELETE' }),

  createRelationship: (familyId: string, input: { sourceMemberId: string; targetMemberId: string; type: RelationshipType }) => (
    apiRequest<{ relationship: FamilyRelationship }>(`/api/families/${encodeURIComponent(familyId)}/relationships`, {
      method: 'POST',
      body: JSON.stringify(input)
    })
  ),

  deleteRelationship: (relationshipId: string) => apiRequest<void>(`/api/relationships/${encodeURIComponent(relationshipId)}`, { method: 'DELETE' }),

  updateLocation: (
    memberId: string,
    input: {
      consentGranted: true;
      source: 'manual' | 'browser' | 'member_shared';
      precision: LocationPrecision;
      visibility: LocationVisibility;
      latitude?: number;
      longitude?: number;
      accuracyM?: number;
      emirate?: string;
      city?: string;
      expiresAt?: string;
    }
  ) => apiRequest<{ safeLocation: SafeLocation }>(`/api/family-members/${encodeURIComponent(memberId)}/location`, {
    method: 'PUT',
    body: JSON.stringify(input)
  }),

  revokeLocation: (memberId: string) => apiRequest<{ safeLocation: null }>(
    `/api/family-members/${encodeURIComponent(memberId)}/location`,
    { method: 'PUT', body: JSON.stringify({ consentGranted: false }) }
  )
};
