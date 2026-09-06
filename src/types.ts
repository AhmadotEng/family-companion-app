/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type Relationship = 'Parent' | 'Child' | 'Grandchild' | 'Grandparent' | 'Relative' | 'Sibling' | 'Admin' | 'Me' | 'Spouse';

export type RelationshipType = 'parent' | 'spouse' | 'sibling' | 'guardian' | 'relative';
export type LocationPrecision = 'emirate' | 'city' | 'approximate' | 'exact';
export type LocationVisibility = 'private' | 'family_admin' | 'family';
export type FamilyRole = 'owner' | 'admin' | 'member';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
}

export interface FamilyAccess {
  id: string;
  name: string;
  role: string;
  linkedMemberId?: string;
}

export interface AuthSession {
  user: AuthUser;
  families: FamilyAccess[];
  activeFamilyId?: string;
}

export interface ApiFamilyMember {
  id: string;
  familyId: string;
  userId?: string;
  displayName: string;
  birthDate?: string;
  phone?: string;
  email?: string;
  interests: string[];
  notes?: string;
  photoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FamilyRelationship {
  id: string;
  familyId: string;
  sourceMemberId: string;
  targetMemberId: string;
  type: RelationshipType;
  createdAt: string;
}

export interface SafeLocation {
  memberId: string;
  source: 'manual' | 'browser' | 'member_shared';
  precision: LocationPrecision;
  visibility: LocationVisibility;
  emirate?: string;
  city?: string;
  distanceBand?: string;
  capturedAt: string;
  expiresAt?: string;
}

export interface FamilyContext {
  family: {
    id: string;
    name: string;
    role: FamilyRole;
  };
  currentUser: AuthUser & { linkedMemberId?: string };
  members: ApiFamilyMember[];
  relationships: FamilyRelationship[];
  safeLocations: SafeLocation[];
}

export interface FamilyMember {
  id: string;
  name: string;
  photo?: string;
  age: number;
  birthday: string;
  relationship: Relationship;
  phone: string;
  email: string;
  interests: string[];
  healthData?: {
    steps?: number;
    sleepHours?: number;
    mood?: string;
    lastActivity?: string;
  };
  locationSharingStatus: 'Active' | 'Inactive' | 'Unknown';
  notes?: string;
  parentIds?: string[];
  spouseId?: string;
  spouseIds?: string[];
  childrenIds?: string[];
  siblingIds?: string[];
  siblingGroupId?: string;
  relativeIds?: string[];
  familyBranch?: string;
  memories?: string[];
  generation?: number;
  /** Server DTO retained so edits never need to reverse-map presentation fields. */
  apiMember?: ApiFamilyMember;
  /** Privacy-filtered location summary. Raw coordinates are never exposed here. */
  safeLocation?: SafeLocation;
}

export interface Family {
  id: string;
  name: string;
  mainAdmin: string;
  members: FamilyMember[];
  createdAt: string;
}

export interface Activity {
  id: string;
  title: string;
  category: string;
  emirate: 'Dubai' | 'Abu Dhabi' | 'Sharjah' | 'Ajman' | 'Umm Al Quwain' | 'Ras Al Khaimah' | 'Fujairah';
  location: string;
  priceRange: 'Free' | 'Budget' | 'Premium';
  ageSuitability: string;
  elderlyFriendly: boolean;
  indoorOutdoor: 'Indoor' | 'Outdoor';
  description: string;
  estimatedDuration: string;
  weatherSuitability: string;
  image?: string;
}

export interface Gathering {
  id: string;
  title: string;
  purpose: string;
  date: string;
  time: string;
  location: string;
  invitedMembers: string[]; // member IDs
  rsvpStatus: Record<string, 'Going' | 'Maybe' | 'Not Going' | 'Pending'>;
  notes?: string;
  createdBy: string;
  type: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string;
  time: string;
  type: 'Gathering' | 'School' | 'Medical' | 'Birthday' | 'Visit' | 'Activity';
  relatedMembers: string[];
  reminderStatus: boolean;
}

export interface FamilyTreePerson {
  id: string;
  name: string;
  photo?: string;
  relationship: string;
  parentIds: string[];
  spouseId?: string;
  spouseIds?: string[];
  childrenIds: string[];
  siblingIds?: string[];
  siblingGroupId?: string;
  birthday: string;
  contactInfo?: string;
  familyBranch?: string;
  notes?: string;
  memories?: string[];
}
