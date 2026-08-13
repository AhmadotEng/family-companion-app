import { afterEach, describe, expect, it, vi } from 'vitest';
import { engagementApi } from './engagement';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('engagement API client mapping', () => {
  it('maps a gathering draft to the authenticated family endpoint unchanged', async () => {
    const gathering = { id: 'gathering-id', invitations: [] };
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ gathering }),
      { status: 201, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const input = {
      title: 'Friday dinner',
      purpose: 'Reconnect',
      startAt: '2026-12-02T18:30:00+04:00',
      timezone: 'Asia/Dubai' as const,
      locationName: 'Family home, Dubai',
      type: 'Meal',
    };
    const result = await engagementApi.createGathering('family id/with spaces', input);

    expect(result.gathering).toEqual(gathering);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [path, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/families/family%20id%2Fwith%20spaces/gatherings');
    expect(request.method).toBe('POST');
    expect(request.credentials).toBe('same-origin');
    expect(JSON.parse(String(request.body))).toEqual(input);
  });

  it('uses the unauthenticated invitation token endpoints for read and response', async () => {
    const token = 'abc/123';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ invitation: { title: 'Dinner' } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ status: 'going', message: 'Recorded' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ));
    vi.stubGlobal('fetch', fetchMock);

    await engagementApi.getPublicInvitation(token);
    await engagementApi.respondToInvitation(token, 'going');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/invitations/abc%2F123');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/invitations/abc%2F123/respond');
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({ status: 'going' });
  });
});
