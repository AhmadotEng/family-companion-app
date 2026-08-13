import { Family, Activity, Gathering, CalendarEvent, FamilyTreePerson } from './types';

export const mockMembers = [
  {
    id: 'm1',
    name: 'Ahmed Al Mansouri',
    age: 42,
    birthday: '1984-05-15',
    relationship: 'Me',
    phone: '+971 50 123 4567',
    email: 'ahmed@family.ae',
    interests: ['Heritage', 'Photography', 'Business'],
    healthData: { steps: 8400, sleepHours: 7.5, mood: 'Focused' },
    locationSharingStatus: 'Active',
    photo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop',
    parentIds: ['m4'],
    childrenIds: ['m3'],
    spouseId: 'm2',
    spouseIds: ['m2'],
    familyBranch: 'Main',
    notes: 'Family Admin',
    memories: ['Preserves Al Mansouri lineage details.'],
    generation: 2
  },
  {
    id: 'm2',
    name: 'Fatima Al Mansouri',
    age: 38,
    birthday: '1988-08-22',
    relationship: 'Spouse',
    phone: '+971 50 234 5678',
    email: 'fatima@family.ae',
    interests: ['Cooking', 'Education', 'Social Work'],
    healthData: { steps: 6200, sleepHours: 8, mood: 'Happy' },
    locationSharingStatus: 'Active',
    photo: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop',
    parentIds: [],
    childrenIds: ['m3'],
    spouseId: 'm1',
    spouseIds: ['m1'],
    familyBranch: 'Main',
    notes: 'Wellbeing Coordinator',
    generation: 2
  },
  {
    id: 'm3',
    name: 'Sultan Al Mansouri',
    age: 12,
    birthday: '2014-03-10',
    relationship: 'Child',
    phone: '',
    email: '',
    interests: ['Robotics', 'Football'],
    healthData: { steps: 12000, sleepHours: 9, mood: 'Energetic' },
    locationSharingStatus: 'Active',
    photo: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&h=100&fit=crop',
    parentIds: ['m1', 'm2'],
    childrenIds: [],
    familyBranch: 'Main',
    notes: 'Enjoys coding and soccer',
    generation: 3
  },
  {
    id: 'm4',
    name: 'Mohammed Al Mansouri',
    age: 68,
    birthday: '1958-11-30',
    relationship: 'Parent',
    phone: '+971 50 345 6789',
    email: '',
    interests: ['Traditional Poetry', 'Falconry'],
    healthData: { steps: 3200, sleepHours: 6, mood: 'Peaceful' },
    locationSharingStatus: 'Active',
    photo: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100&h=100&fit=crop',
    parentIds: [],
    childrenIds: ['m1'],
    familyBranch: 'Elders',
    notes: 'Family patriarch, loves poetry.',
    memories: ['Shares details of pearl trading routes in historical meetings.'],
    generation: 1
  }
];

export const mockFamily: Family = {
  id: 'f1',
  name: 'Al Mansouri Family',
  mainAdmin: 'm1',
  members: mockMembers as any,
  createdAt: '2025-01-01'
};

export const mockActivities: Activity[] = [
  {
    id: 'a1',
    title: 'Louvre Abu Dhabi Family Tour',
    category: 'Museums',
    emirate: 'Abu Dhabi',
    location: 'Saadiyat Cultural District',
    priceRange: 'Premium',
    ageSuitability: 'All ages',
    elderlyFriendly: true,
    indoorOutdoor: 'Indoor',
    description: 'Explore world-class art in a stunning architectural masterpiece.',
    estimatedDuration: '3-4 hours',
    weatherSuitability: 'Perfect for summer',
    image: 'https://images.unsplash.com/photo-1518998053574-53f1f61f9b86?w=400&h=300&fit=crop'
  },
  {
    id: 'a2',
    title: 'Al Qudra Lakes Picnic',
    category: 'Parks',
    emirate: 'Dubai',
    location: 'Al Marmoom Desert Conservation Reserve',
    priceRange: 'Free',
    ageSuitability: '5+ years',
    elderlyFriendly: false,
    indoorOutdoor: 'Outdoor',
    description: 'Enjoy nature and wildlife in the heart of the desert.',
    estimatedDuration: '4-5 hours',
    weatherSuitability: 'Best in winter months',
    image: 'https://images.unsplash.com/photo-1444491741275-3747c03c996.jpg?w=400&h=300&fit=crop'
  },
  {
    id: 'a3',
    title: 'Qasr Al Hosn Heritage Visit',
    category: 'Heritage',
    emirate: 'Abu Dhabi',
    location: 'Downtown Abu Dhabi',
    priceRange: 'Budget',
    ageSuitability: 'All ages',
    elderlyFriendly: true,
    indoorOutdoor: 'Indoor',
    description: 'Discover the oldest stone building in Abu Dhabi and traditional craft live demonstrations.',
    estimatedDuration: '2 hours',
    weatherSuitability: 'Year round',
    image: 'https://images.unsplash.com/photo-1584551246679-0daf3d275d0f?w=400&h=300&fit=crop'
  },
  {
    id: 'a4',
    title: 'Al Mamzar Beach Family Chalet',
    category: 'Beach',
    emirate: 'Dubai',
    location: 'Al Mamzar area',
    priceRange: 'Premium',
    ageSuitability: 'All ages',
    elderlyFriendly: true,
    indoorOutdoor: 'Outdoor',
    description: 'Rent a private air-conditioned chalet right on the beach, perfect for family bonding and BBQ.',
    estimatedDuration: '6-8 hours',
    weatherSuitability: 'Excellent in winter/spring',
    image: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&h=300&fit=crop'
  },
  {
    id: 'a5',
    title: 'Sharjah Museum of Islamic Civilization',
    category: 'Museums',
    emirate: 'Sharjah',
    location: 'Al Majarrah Area',
    priceRange: 'Budget',
    ageSuitability: 'All ages',
    elderlyFriendly: true,
    indoorOutdoor: 'Indoor',
    description: 'Explore thousands of Islamic artifacts and scientific achievements of the golden age.',
    estimatedDuration: '2-3 hours',
    weatherSuitability: 'Perfect for summer',
    image: 'https://images.unsplash.com/photo-1565034946487-077786996e27?w=400&h=300&fit=crop'
  },
  {
    id: 'a6',
    title: 'Al Badiah Mosque & Fujairah Fort Tour',
    category: 'Heritage',
    emirate: 'Fujairah',
    location: 'Al Badiyah village',
    priceRange: 'Free',
    ageSuitability: 'All ages',
    elderlyFriendly: false,
    indoorOutdoor: 'Outdoor',
    description: 'Visit the oldest mud-brick mosque in the UAE, dating back to the 15th century, and adjacent ruins.',
    estimatedDuration: '3 hours',
    weatherSuitability: 'Best in winter months',
    image: 'https://images.unsplash.com/photo-1628155930542-3c7a64e2c833?w=400&h=300&fit=crop'
  }
];

export const mockGatherings: Gathering[] = [
  {
    id: 'g1',
    title: 'Weekend Family Lunch',
    purpose: 'Weekly bonding',
    date: '2026-05-22',
    time: '13:30',
    location: 'Grandfather\'s Majlis',
    invitedMembers: ['m1', 'm2', 'm3', 'm4'],
    rsvpStatus: { m1: 'Going', m2: 'Going', m3: 'Going', m4: 'Going' },
    createdBy: 'm1',
    type: 'Majlis'
  }
];

export const mockEvents: CalendarEvent[] = [
  {
    id: 'e1',
    title: 'Sultan\'s Science Project',
    date: '2026-05-20',
    time: '09:00',
    type: 'School',
    relatedMembers: ['m3'],
    reminderStatus: true
  }
];

export const mockTreeData: FamilyTreePerson[] = [
  {
    id: 'p1',
    name: 'Mohammed Al Mansouri',
    relationship: 'Grandfather',
    parentIds: [],
    childrenIds: ['p2', 'p3'],
    birthday: '1958-11-30',
    familyBranch: 'Elders'
  },
  {
    id: 'p2',
    name: 'Ahmed Al Mansouri',
    relationship: 'Father',
    parentIds: ['p1'],
    childrenIds: ['p4', 'p5'],
    spouseId: 'p6',
    birthday: '1984-05-15',
    familyBranch: 'Main'
  }
];
