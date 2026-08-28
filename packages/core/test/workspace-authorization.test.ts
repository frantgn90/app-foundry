import { describe, expect, it } from 'vitest';

import {
  canAdministerWorkspace,
  canLeaveWorkspace,
  canManageAccounts,
  DenialReason,
  PlatformRole,
  platformAdminHasContentAccess,
  WorkspaceRole,
} from '../src/index.js';
import { actor, GUEST, membership, OWNER, STRANGER } from './factories.js';

describe('administrar un workspace', () => {
  it('el dueño invita, expulsa y renombra', () => {
    expect(
      canAdministerWorkspace({ actor: actor(OWNER), membership: membership(OWNER) }).allowed,
    ).toBe(true);
  });

  it('un invitado no administra el workspace ajeno', () => {
    const decision = canAdministerWorkspace({
      actor: actor(GUEST),
      membership: membership(GUEST, WorkspaceRole.MEMBER),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.allowed === false && decision.reason).toBe(DenialReason.NOT_THE_OWNER);
  });

  it('un extraño ni siquiera es miembro', () => {
    const decision = canAdministerWorkspace({ actor: actor(STRANGER), membership: null });
    expect(decision.allowed === false && decision.reason).toBe(DenialReason.NOT_A_MEMBER);
  });
});

describe('abandonar un workspace', () => {
  it('un invitado puede irse', () => {
    expect(
      canLeaveWorkspace({
        actor: actor(GUEST),
        membership: membership(GUEST, WorkspaceRole.MEMBER),
      }).allowed,
    ).toBe(true);
  });

  it('el dueño no puede abandonar el suyo (RF-310)', () => {
    const decision = canLeaveWorkspace({ actor: actor(OWNER), membership: membership(OWNER) });
    expect(decision.allowed === false && decision.reason).toBe(DenialReason.OWNER_CANNOT_LEAVE);
  });
});

describe('administración de plataforma', () => {
  it('un ADMIN gestiona cuentas', () => {
    expect(canManageAccounts(actor(OWNER, { platformRole: PlatformRole.ADMIN })).allowed).toBe(
      true,
    );
  });

  it('un MEMBER no gestiona cuentas', () => {
    expect(canManageAccounts(actor(OWNER)).allowed).toBe(false);
  });

  it('el ADMIN nunca tiene acceso al contenido de workspaces ajenos (D-6)', () => {
    expect(platformAdminHasContentAccess()).toBe(false);
  });
});
