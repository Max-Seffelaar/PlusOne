/**
 * Review #466 P1-2: the who-did-what labels ("PlusOne support", "System",
 * "Unnamed") and a blank name are not a name a user may take. Mirrors the DB
 * CHECK user_profiles_full_name_not_reserved (20261016140100); the app refuses
 * first, with a friendly message from the catalogue, on every path where a
 * user sets their own name (profile edit + consent screen share profileSchema).
 */
import { describe, it, expect } from 'vitest';
import { isReservedProfileName, profileNameSchema, profileSchema } from './schemas';
import { t } from '@/lib/i18n';

describe('isReservedProfileName', () => {
  it.each(['PlusOne support', 'plusone support', '  PLUSONE   Support ', 'System', ' system ', 'Unnamed', '', '   '])(
    'refuses %j',
    (name) => expect(isReservedProfileName(name)).toBe(true),
  );

  it.each(['Max Seffelaar', 'PlusOne', 'Support Desk', 'Systemic Sam', 'PIusOne support'])(
    'allows %j (look-alikes are an accepted residual)',
    (name) => expect(isReservedProfileName(name)).toBe(false),
  );
});

describe('profileSchema (profile edit + consent)', () => {
  const base = { firstName: 'Tom', lastName: 'Bakker', phone: '' };

  it('accepts an ordinary name', () => {
    expect(profileSchema.safeParse(base).success).toBe(true);
  });

  it('refuses a first + last name that together read as a label', () => {
    const res = profileSchema.safeParse({ ...base, firstName: 'PlusOne', lastName: 'Support' });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toBe(t.shared.actor.reservedName);
  });

  it('refuses the label whatever the case or inner spacing', () => {
    const res = profileSchema.safeParse({ ...base, firstName: '  plusone ', lastName: 'SUPPORT' });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toBe(t.shared.actor.reservedName);
  });
});

describe('profileNameSchema', () => {
  it('refuses a reserved full name with the catalogue message', () => {
    const res = profileNameSchema.safeParse({ fullName: ' system ' });
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.message).toBe(t.shared.actor.reservedName);
  });

  it('accepts an ordinary full name', () => {
    expect(profileNameSchema.safeParse({ fullName: 'Lisa van den Berg' }).success).toBe(true);
  });
});
