import { RelationshipType } from '../types';

export type RelativeLinkType = 'Father' | 'Mother' | 'Son' | 'Daughter' | 'Brother' | 'Sister' | 'Spouse';

export interface InitialRelationshipInput {
  relatedMemberId: string;
  type: RelationshipType;
  direction: 'source' | 'target';
}

export interface AddRelativeFormInput {
  displayName: string;
  birthDate: string;
  phone: string;
  notes: string;
  photoUrl: string;
  relatedMemberId: string;
  linkType: RelativeLinkType;
  coParentId?: string;
  emirate?: string;
}

export interface AddRelativeRequest {
  displayName: string;
  birthDate?: string;
  phone?: string;
  interests: string[];
  notes?: string;
  photoUrl?: string;
  relationships: InitialRelationshipInput[];
  location?: {
    emirate: string;
    precision: 'emirate';
    visibility: 'family_admin';
  };
}

export function buildInitialRelationships(
  linkType: RelativeLinkType,
  relatedMemberId: string,
  coParentId?: string
): InitialRelationshipInput[] {
  if (linkType === 'Father' || linkType === 'Mother') {
    return [{ relatedMemberId, type: 'parent', direction: 'source' }];
  }

  if (linkType === 'Son' || linkType === 'Daughter') {
    const relationships: InitialRelationshipInput[] = [
      { relatedMemberId, type: 'parent', direction: 'target' }
    ];

    if (coParentId && coParentId !== relatedMemberId) {
      // For a child, each existing parent is the source and the new member is
      // the target. Using "source" here would incorrectly make the child the
      // parent of the selected co-parent.
      relationships.push({ relatedMemberId: coParentId, type: 'parent', direction: 'target' });
    }

    return relationships;
  }

  if (linkType === 'Brother' || linkType === 'Sister') {
    return [{ relatedMemberId, type: 'sibling', direction: 'source' }];
  }

  return [{ relatedMemberId, type: 'spouse', direction: 'source' }];
}

export function buildAddRelativeRequest(input: AddRelativeFormInput): AddRelativeRequest {
  const emirate = input.emirate?.trim();

  return {
    displayName: input.displayName.trim(),
    birthDate: input.birthDate || undefined,
    phone: input.phone.trim() || undefined,
    interests: [],
    notes: input.notes.trim() || undefined,
    photoUrl: input.photoUrl || undefined,
    relationships: buildInitialRelationships(
      input.linkType,
      input.relatedMemberId,
      input.coParentId
    ),
    location: emirate
      ? { emirate, precision: 'emirate', visibility: 'family_admin' }
      : undefined
  };
}
