import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import {
  gatheringPlannerPayloadSchema,
  type AgentProvider,
  type AgentProviderInput,
} from '../server/agent';
import { createApp } from '../server/app';
import { openDatabase, type AppDatabase } from '../server/database';

const TEST_NOW = new Date('2026-08-13T12:00:00.000Z');
const databases: AppDatabase[] = [];

const MONTH_SPELLINGS = [
  ['January', 1], ['Jan', 1],
  ['February', 2], ['Feb', 2],
  ['March', 3], ['Mar', 3],
  ['April', 4], ['Apr', 4],
  ['May', 5],
  ['June', 6], ['Jun', 6],
  ['July', 7], ['Jul', 7],
  ['August', 8], ['Aug', 8],
  ['September', 9], ['Sep', 9], ['Sept', 9],
  ['October', 10], ['Oct', 10],
  ['November', 11], ['Nov', 11],
  ['December', 12], ['Dec', 12],
] as const;

const WEEKDAY_DATES = [
  ['Sunday', '2026-08-16'],
  ['Monday', '2026-08-17'],
  ['Tuesday', '2026-08-18'],
  ['Wednesday', '2026-08-19'],
  ['Thursday', '2026-08-13'],
  ['Friday', '2026-08-14'],
  ['Saturday', '2026-08-15'],
] as const;

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

function database(): AppDatabase {
  const db = openDatabase({ path: ':memory:' });
  databases.push(db);
  return db;
}

function provider(decision: (input: AgentProviderInput) => unknown): AgentProvider {
  return { generate: async input => decision(input) };
}

function planner(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'gathering_planner' as const,
    message: 'Provider planner response',
    planner: {
      title: 'Provider title',
      purpose: 'Provider purpose',
      startAt: '2099-09-12T17:00:00+04:00',
      timezone: 'Asia/Dubai' as const,
      locationName: 'Golden Park',
      type: 'Outdoor activity' as const,
      memberIds: [],
      invitationChannel: 'share_link' as const,
      ...overrides,
    },
  };
}

async function registeredBrowser(index: string, decision: () => unknown) {
  const db = database();
  const app = createApp({
    database: db,
    agentProvider: provider(decision),
    bcryptRounds: 4,
    rateLimitEnabled: false,
    now: () => TEST_NOW,
  });
  const browser = request.agent(app);
  const registration = await browser
    .post('/api/auth/register')
    .send({
      email: `agent-gathering-matrix-${index}@example.test`,
      displayName: 'Ahmad',
      familyName: `Gathering Matrix ${index}`,
      password: 'a-secure-password',
    })
    .expect(201);
  return {
    browser,
    familyId: registration.body.families[0].id as string,
    db,
  };
}

describe('agent gathering type and schema option matrix', () => {
  it.each([
    ['family-gathering', 'Plan a family gathering at Home on September 12, 2099 at 5 PM.', 'Home', 'Celebration', 'Family gathering'],
    ['majlis', 'Plan a majlis at Home on September 12, 2099 at 5 PM.', 'Home', 'Celebration', 'Majlis'],
    ['meal', 'Plan dinner at Home on September 12, 2099 at 5 PM.', 'Home', 'Celebration', 'Meal'],
    ['outdoor', 'Plan a picnic at Golden Park on September 12, 2099 at 5 PM.', 'Golden Park', 'Celebration', 'Outdoor activity'],
    ['celebration', 'Plan a birthday party at Home on September 12, 2099 at 5 PM.', 'Home', 'Meal', 'Celebration'],
    ['visit', "Plan a visit at Grandma's house on September 12, 2099 at 5 PM.", "Grandma's house", 'Celebration', 'Visit'],
    ['phone', 'Plan a phone call on September 12, 2099 at 5 PM.', 'Online', 'Celebration', 'Phone call'],
    ['video', 'Plan a video call on September 12, 2099 at 5 PM.', 'Online', 'Celebration', 'Video call'],
  ] as const)('derives the supported %s type only from user evidence', async (id, message, locationName, providerType, expectedType) => {
    const { browser, familyId } = await registeredBrowser(`type-${id}`, () =>
      planner({ locationName, type: providerType }),
    );

    const response = await browser.post('/api/agent/messages').send({ familyId, message }).expect(200);

    expect(response.body).toMatchObject({
      kind: 'gathering_planner',
      planner: { type: expectedType, locationName },
    });
  });

  it.each([
    ['family', 'Family gathering'],
    ['gathering', 'Family gathering'],
    ['family meal', 'Meal'],
    ['breakfast', 'Meal'],
    ['lunch', 'Meal'],
    ['dinner', 'Meal'],
    ['outdoor', 'Outdoor activity'],
    ['outing', 'Outdoor activity'],
    ['picnic', 'Outdoor activity'],
    ['party', 'Celebration'],
    ['home visit', 'Visit'],
    ['phone', 'Phone call'],
    ['call', 'Phone call'],
    ['video', 'Video call'],
  ] as const)('normalizes provider type alias %s', (alias, expected) => {
    const parsed = gatheringPlannerPayloadSchema.parse(planner({ type: alias }).planner);
    expect(parsed.type).toBe(expected);
  });

  it.each([
    ['timezone', { timezone: 'UTC' }],
    ['unknown-type', { type: 'Road trip' }],
    ['offsetless-time', { startAt: '2099-09-12T17:00:00' }],
    ['invalid-channel', { invitationChannel: 'sms' }],
    ['invalid-member-id', { memberIds: ['not-a-uuid'] }],
    ['too-many-members', { memberIds: Array.from({ length: 201 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`) }],
    ['extra-property', { unsupported: true }],
  ] as const)('rejects invalid planner schema option %s', (_name, overrides) => {
    expect(gatheringPlannerPayloadSchema.safeParse(planner(overrides).planner).success).toBe(false);
  });
});

describe('agent gathering schedule evidence matrix', () => {
  it.each([
    ['month-first', 'September 12, 2099 at 5 PM', '2099-09-12T17:00:00+04:00'],
    ['month-abbreviation', 'Sep 12 2099 at 5:00 p.m.', '2099-09-12T17:00:00+04:00'],
    ['day-first', '12 September 2099 at 17:00', '2099-09-12T17:00:00+04:00'],
    ['ordinal-day-first', '12th of September 2099 at 5 PM', '2099-09-12T17:00:00+04:00'],
    ['iso-date', '2099-09-12 at 17:00', '2099-09-12T17:00:00+04:00'],
    ['uae-slash-date', '12/09/2099 at 17:00', '2099-09-12T17:00:00+04:00'],
    ['uae-dot-date', '12.09.2099 at 17:00', '2099-09-12T17:00:00+04:00'],
    ['noon', 'September 12, 2099 at noon', '2099-09-12T12:00:00+04:00'],
    ['midnight', 'September 12, 2099 at midnight', '2099-09-12T00:00:00+04:00'],
    ['twelve-am', 'September 12, 2099 at 12 AM', '2099-09-12T00:00:00+04:00'],
    ['twelve-pm', 'September 12, 2099 at 12 PM', '2099-09-12T12:00:00+04:00'],
    ['today', 'today at 8 PM', '2026-08-13T20:00:00+04:00'],
    ['tonight', 'tonight at 8 PM', '2026-08-13T20:00:00+04:00'],
    ['tomorrow', 'tomorrow at 5 PM', '2026-08-14T17:00:00+04:00'],
    ['day-after-tomorrow', 'the day after tomorrow at 5 PM', '2026-08-15T17:00:00+04:00'],
    ['bare-weekday', 'Friday at 5 PM', '2026-08-14T17:00:00+04:00'],
    ['this-weekday', 'this Thursday at 8 PM', '2026-08-13T20:00:00+04:00'],
    ['next-weekday', 'next Thursday at 5 PM', '2026-08-20T17:00:00+04:00'],
    ['future-no-year', 'September 12 at 5 PM', '2026-09-12T17:00:00+04:00'],
    ['rolled-no-year', 'July 12 at 5 PM', '2027-07-12T17:00:00+04:00'],
  ] as const)('accepts and verifies the %s schedule form', async (id, phrase, startAt) => {
    const { browser, familyId } = await registeredBrowser(`schedule-${id}`, () => planner({ startAt }));

    const response = await browser
      .post('/api/agent/messages')
      .send({ familyId, message: `Plan at Golden Park ${phrase}.` })
      .expect(200);

    expect(response.body).toMatchObject({
      kind: 'gathering_planner',
      planner: { startAt },
    });
  });

  it.each(MONTH_SPELLINGS)('recognizes the complete supported month spelling %s', async (monthName, month) => {
    const startAt = `2099-${String(month).padStart(2, '0')}-15T17:00:00+04:00`;
    const { browser, familyId } = await registeredBrowser(`month-${monthName.toLowerCase()}`, () => planner({ startAt }));

    const response = await browser
      .post('/api/agent/messages')
      .send({ familyId, message: `Plan at Golden Park ${monthName} 15, 2099 at 5 PM.` })
      .expect(200);

    expect(response.body).toMatchObject({ kind: 'gathering_planner', planner: { startAt } });
  });

  it.each(Array.from({ length: 12 }, (_, index) => index + 1).flatMap(hour => (
    ['AM', 'PM'].map(meridiem => [hour, meridiem] as const)
  )))('converts the complete 12-hour clock domain: %s %s', async (hour, meridiem) => {
    const convertedHour = meridiem === 'AM'
      ? (hour === 12 ? 0 : hour)
      : (hour === 12 ? 12 : hour + 12);
    const startAt = `2099-09-12T${String(convertedHour).padStart(2, '0')}:37:00+04:00`;
    const { browser, familyId } = await registeredBrowser(`clock-${hour}-${meridiem}`, () => planner({ startAt }));

    const response = await browser
      .post('/api/agent/messages')
      .send({ familyId, message: `Plan at Golden Park September 12, 2099 at ${hour}:37 ${meridiem}.` })
      .expect(200);

    expect(response.body).toMatchObject({ kind: 'gathering_planner', planner: { startAt } });
  });

  it.each([0, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23])(
    'accepts each unambiguous 24-hour clock hour: %s',
    async hour => {
      const startAt = `2099-09-12T${String(hour).padStart(2, '0')}:37:00+04:00`;
      const { browser, familyId } = await registeredBrowser(`24-hour-${hour}`, () => planner({ startAt }));

      const response = await browser
        .post('/api/agent/messages')
        .send({ familyId, message: `Plan at Golden Park September 12, 2099 at ${String(hour).padStart(2, '0')}:37.` })
        .expect(200);

      expect(response.body).toMatchObject({ kind: 'gathering_planner', planner: { startAt } });
    },
  );

  it.each(Array.from({ length: 12 }, (_, index) => index + 1))(
    'asks for AM or PM for each ambiguous colon hour: %s',
    async hour => {
      const { browser, familyId, db } = await registeredBrowser(`ambiguous-hour-${hour}`, () => planner());
      const response = await browser
        .post('/api/agent/messages')
        .send({ familyId, message: `Plan at Golden Park September 12, 2099 at ${hour}:37.` })
        .expect(200);

      expect(response.body).toMatchObject({ kind: 'clarification', message: expect.stringMatching(/AM or PM/i) });
      expect((db.prepare('SELECT COUNT(*) AS count FROM gatherings').get() as { count: number }).count).toBe(0);
    },
  );

  it.each(WEEKDAY_DATES)('resolves every supported weekday: %s', async (weekday, date) => {
    const startAt = `${date}T20:00:00+04:00`;
    const { browser, familyId } = await registeredBrowser(`weekday-${weekday.toLowerCase()}`, () => planner({ startAt }));
    const response = await browser
      .post('/api/agent/messages')
      .send({ familyId, message: `Plan at Golden Park ${weekday} at 8 PM.` })
      .expect(200);

    expect(response.body).toMatchObject({ kind: 'gathering_planner', planner: { startAt } });
  });

  it('accepts a real leap day', async () => {
    const startAt = '2028-02-29T17:00:00+04:00';
    const { browser, familyId } = await registeredBrowser('valid-leap-day', () => planner({ startAt }));
    const response = await browser
      .post('/api/agent/messages')
      .send({ familyId, message: 'Plan at Golden Park February 29, 2028 at 5 PM.' })
      .expect(200);

    expect(response.body).toMatchObject({ kind: 'gathering_planner', planner: { startAt } });
  });

  it.each([
    ['invalid-month-day', 'September 31, 2099 at 5 PM'],
    ['non-leap-day', 'February 29, 2099 at 5 PM'],
    ['invalid-numeric-date', '13/13/2099 at 5 PM'],
    ['invalid-hour', 'September 12, 2099 at 25:00'],
    ['invalid-minute', 'September 12, 2099 at 5:60 PM'],
    ['missing-date', 'at 5 PM'],
    ['missing-time', 'September 12, 2099'],
  ] as const)('clarifies rather than guessing the %s schedule', async (id, phrase) => {
    const { browser, familyId, db } = await registeredBrowser(`invalid-schedule-${id}`, () => planner());

    const response = await browser
      .post('/api/agent/messages')
      .send({ familyId, message: `Plan at Golden Park ${phrase}.` })
      .expect(200);

    expect(response.body.kind).toBe('clarification');
    expect(response.body).not.toHaveProperty('planner');
    expect((db.prepare('SELECT COUNT(*) AS count FROM gatherings').get() as { count: number }).count).toBe(0);
  });
});

describe('agent gathering invitation-channel language matrix', () => {
  it.each([
    ['default', '', 'whatsapp', 'share_link'],
    ['positive-use', 'Use WhatsApp.', 'share_link', 'whatsapp'],
    ['positive-via', 'Share via WhatsApp.', 'share_link', 'whatsapp'],
    ['positive-only', 'WhatsApp please.', 'share_link', 'whatsapp'],
    ['negative-without', 'Without WhatsApp.', 'whatsapp', 'share_link'],
    ['negative-avoid', 'Avoid WhatsApp.', 'whatsapp', 'share_link'],
    ['negative-not-needed', 'WhatsApp is not needed.', 'whatsapp', 'share_link'],
    ['copyable', 'Use copyable links.', 'whatsapp', 'share_link'],
    ['links-instead', 'Use links instead.', 'whatsapp', 'share_link'],
  ] as const)('grounds channel option %s in user wording', async (id, suffix, providerChannel, expected) => {
    const { browser, familyId } = await registeredBrowser(`channel-${id}`, () =>
      planner({ invitationChannel: providerChannel }),
    );
    const response = await browser
      .post('/api/agent/messages')
      .send({
        familyId,
        message: `Plan at Golden Park on September 12, 2099 at 5 PM. ${suffix}`,
      })
      .expect(200);
    expect(response.body).toMatchObject({
      kind: 'gathering_planner',
      planner: { invitationChannel: expected },
    });
  });
});
