import { describe, expect, it } from 'vitest';
import {
  buildCreateMemoryRequest,
  MAX_MEMORY_UPLOAD_BYTES,
  validateMemoryDraft,
  validateMemoryFile
} from './memoriesRewards';

describe('memory request mapping', () => {
  it('trims text, removes duplicate selected viewers, and keeps AI consent off by default', () => {
    expect(buildCreateMemoryRequest({
      familyId: 'family-1',
      title: '  Friday Majlis  ',
      note: '  Grandmother shared a story.  ',
      memoryType: 'note',
      visibility: 'selected',
      selectedMemberIds: ['member-1', 'member-1', 'member-2'],
      capturedAt: '2026-08-13T12:00:00.000Z'
    })).toEqual({
      familyId: 'family-1',
      title: 'Friday Majlis',
      note: 'Grandmother shared a story.',
      memoryType: 'note',
      visibility: 'selected',
      selectedMemberIds: ['member-1', 'member-2'],
      aiProcessingAllowed: false,
      capturedAt: '2026-08-13T12:00:00.000Z'
    });
  });

  it('never sends stale selected viewers for a broader visibility setting', () => {
    const request = buildCreateMemoryRequest({
      familyId: 'family-1',
      title: 'Family photo',
      memoryType: 'photo',
      visibility: 'family',
      selectedMemberIds: ['member-private'],
      aiProcessingAllowed: true,
      capturedAt: '2026-08-13T12:00:00.000Z'
    });
    expect(request.selectedMemberIds).toEqual([]);
    expect(request.aiProcessingAllowed).toBe(true);
  });
});

describe('memory validation guards', () => {
  it('enforces the 15 MB limit before any upload starts', () => {
    expect(validateMemoryFile('photo', { type: 'image/jpeg', size: MAX_MEMORY_UPLOAD_BYTES })).toBeNull();
    expect(validateMemoryFile('photo', { type: 'image/jpeg', size: MAX_MEMORY_UPLOAD_BYTES + 1 })).toContain('15 MB');
  });

  it('accepts only media types supported by the matching server memory kind', () => {
    expect(validateMemoryFile('photo', { type: 'image/webp', size: 100 })).toBeNull();
    expect(validateMemoryFile('photo', { type: 'video/mp4', size: 100 })).toContain('not supported');
    expect(validateMemoryFile('video', { type: 'video/mp4', size: 100 })).toBeNull();
    expect(validateMemoryFile('audio', { type: 'audio/webm', size: 100 })).toBeNull();
    expect(validateMemoryFile('audio', { type: '', size: 100 })).toContain('not supported');
    expect(validateMemoryFile('audio', { type: 'audio/mpeg', size: 0 })).toContain('non-empty');
  });

  it('requires written content and explicit viewers when those choices demand them', () => {
    const base = {
      familyId: 'family-1',
      title: 'A memory',
      memoryType: 'note' as const,
      visibility: 'private' as const,
      capturedAt: '2026-08-13T12:00:00.000Z'
    };
    expect(validateMemoryDraft(base)).toContain('Write the memory');
    expect(validateMemoryDraft({ ...base, note: 'A story', visibility: 'selected', selectedMemberIds: [] })).toContain('at least one');
    expect(validateMemoryDraft({ ...base, note: 'A story' })).toBeNull();
  });
});
