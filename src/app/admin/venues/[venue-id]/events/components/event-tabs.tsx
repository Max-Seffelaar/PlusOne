'use client';

import { useState } from 'react';
import { EventGeneralTab } from './event-general-tab';
import { EventTiersTab } from './event-tiers-tab';
import { EventOrganizersTab } from './event-organizers-tab';
import { EventLandingTab } from './event-landing-tab';

interface TabsProps {
  venueId: string;
  event: any;
  tiers: any[];
  organizers: any[];
  availableUsers: any[];
  currentUserId: string;
}

export function EventTabs({
  venueId,
  event,
  tiers,
  organizers,
  availableUsers,
  currentUserId,
}: TabsProps) {
  const [activeTab, setActiveTab] = useState<'general' | 'tiers' | 'organizers' | 'landing'>('general');

  const tabs = [
    { id: 'general', label: 'Instellingen', icon: '⚙️' },
    { id: 'tiers', label: 'Lagen', icon: '🎯' },
    { id: 'organizers', label: 'Organisators', icon: '👤' },
    { id: 'landing', label: 'Landingpagina', icon: '🔗' },
  ];

  return (
    <div>
      {/* Tab Navigation */}
      <div className="flex gap-2 mb-6 border-b border-line pb-4 flex-wrap">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2 font-medium text-sm rounded-lg transition-colors ${
              activeTab === tab.id
                ? 'bg-accent text-bg'
                : 'text-dim hover:text-text hover:bg-elev'
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'general' && (
          <EventGeneralTab venueId={venueId} event={event} />
        )}
        {activeTab === 'tiers' && (
          <EventTiersTab venueId={venueId} eventId={event.id} tiers={tiers} />
        )}
        {activeTab === 'organizers' && (
          <EventOrganizersTab
            venueId={venueId}
            eventId={event.id}
            organizers={organizers}
            availableUsers={availableUsers}
          />
        )}
        {activeTab === 'landing' && (
          <EventLandingTab venueId={venueId} event={event} />
        )}
      </div>
    </div>
  );
}
