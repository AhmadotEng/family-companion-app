/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { Layout } from './components/Layout';
import { Home } from './screens/Home';
import { Assistant } from './screens/Assistant';
import { Activities } from './screens/Activities';
import { FamilyTree } from './screens/FamilyTree';
import { Calendar } from './screens/Calendar';
import { More } from './screens/More';
import { mockMembers, mockGatherings, mockEvents, mockTreeData, mockActivities } from './mockData';
import { FamilyMember, Gathering, CalendarEvent, FamilyTreePerson } from './types';

export default function App() {
  const [activeTab, setActiveTab] = useState('home');
  const [members, setMembers] = useState<FamilyMember[]>(mockMembers as any);
  const [gatherings, setGatherings] = useState<Gathering[]>(mockGatherings);
  const [events, setEvents] = useState<CalendarEvent[]>(mockEvents);
  const [assistantPreset, setAssistantPreset] = useState<string>('');

  // Keep gatherings and events in sync with members list
  useEffect(() => {
    setGatherings(prev => prev.map(g => {
      const updatedInvited = g.invitedMembers.filter(id => members.some(m => m.id === id));
      const updatedRsvp: Record<string, 'Going' | 'Maybe' | 'Not Going' | 'Pending'> = {};
      updatedInvited.forEach(id => {
        updatedRsvp[id] = g.rsvpStatus[id] || 'Pending';
      });

      return {
        ...g,
        invitedMembers: updatedInvited,
        rsvpStatus: updatedRsvp
      };
    }));
  }, [members]);

  const navigateToAssistant = (presetText: string) => {
    setAssistantPreset(presetText);
    setActiveTab('assistant');
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'home':
        return (
          <Home 
            members={members} 
            gatherings={gatherings} 
            setActiveTab={setActiveTab}
            navigateToAssistant={navigateToAssistant}
            setMembers={setMembers}
          />
        );
      case 'assistant':
        return (
          <Assistant 
            presetInput={assistantPreset}
            clearPreset={() => setAssistantPreset('')}
            members={members}
          />
        );
      case 'activities':
        return <Activities members={members} />;
      case 'tree':
        return (
          <FamilyTree 
            members={members}
            setMembers={setMembers}
          />
        );
      case 'calendar':
        return (
          <Calendar 
            gatherings={gatherings} 
            setGatherings={setGatherings}
            events={events}
            setEvents={setEvents}
            members={members}
          />
        );
      case 'more':
        return <More members={members} setMembers={setMembers} />;
      default:
        return (
          <Home 
            members={members} 
            gatherings={gatherings} 
            setActiveTab={setActiveTab} 
            navigateToAssistant={navigateToAssistant}
            setMembers={setMembers}
          />
        );
    }
  };

  const titles: Record<string, string> = {
    home: "Family Dashboard",
    assistant: "AI Family Companion",
    activities: "Family Activities",
    tree: "Digital Family Tree",
    calendar: "Family Calendar",
    more: "Settings & Profile"
  };

  return (
    <Layout activeTab={activeTab} setActiveTab={setActiveTab} title={titles[activeTab]}>
      {renderContent()}
    </Layout>
  );
}
