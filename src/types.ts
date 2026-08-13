/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type Relationship = 'Parent' | 'Child' | 'Grandchild' | 'Grandparent' | 'Relative' | 'Admin' | 'Me' | 'Spouse';

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
  siblingGroupId?: string;
  familyBranch?: string;
  memories?: string[];
  generation?: number;
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
  siblingGroupId?: string;
  birthday: string;
  contactInfo?: string;
  familyBranch?: string;
  notes?: string;
  memories?: string[];
}
