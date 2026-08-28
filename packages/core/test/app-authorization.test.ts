import { describe, expect, it } from 'vitest';

import {
  AccessLevel,
  canChangeAccessLevel,
  canCommentOnApp,
  canCreateApp,
  canEditApp,
  canViewApp,
  DenialReason,
  initialAccessLevel,
  PlatformRole,
  UserStatus,
  WorkspaceRole,
} from '../src/index.js';
import { actor, app, GUEST, membership, OWNER, STRANGER } from './factories.js';

/** Atajo: el motivo de la denegación, o null si estaba permitido. */
const reasonOf = (d: { allowed: boolean; reason?: DenialReason }): DenialReason | null =>
  d.allowed ? null : (d.reason ?? null);

describe('ver una app', () => {
  it('el precursor ve su app privada', () => {
    const decision = canViewApp({
      actor: actor(OWNER),
      membership: membership(OWNER),
      app: app(),
    });
    expect(decision.allowed).toBe(true);
  });

  it('un invitado del workspace no ve una app privada ajena', () => {
    const decision = canViewApp({
      actor: actor(GUEST),
      membership: membership(GUEST, WorkspaceRole.MEMBER),
      app: app(),
    });
    expect(reasonOf(decision)).toBe(DenialReason.APP_IS_PRIVATE);
  });

  it('quien no pertenece al workspace no ve nada, ni siquiera lo compartido', () => {
    const decision = canViewApp({
      actor: actor(STRANGER),
      membership: null,
      app: app({ accessLevel: AccessLevel.WORKSPACE_WRITE }),
    });
    expect(reasonOf(decision)).toBe(DenialReason.NOT_A_MEMBER);
  });

  it('un administrador de plataforma no ve contenido de un workspace ajeno', () => {
    const decision = canViewApp({
      actor: actor(STRANGER, { platformRole: PlatformRole.ADMIN }),
      membership: null,
      app: app({ accessLevel: AccessLevel.WORKSPACE_READ }),
    });
    expect(reasonOf(decision)).toBe(DenialReason.NOT_A_MEMBER);
  });

  it('una cuenta desactivada no ve nada', () => {
    const decision = canViewApp({
      actor: actor(OWNER, { status: UserStatus.DEACTIVATED }),
      membership: membership(OWNER),
      app: app(),
    });
    expect(reasonOf(decision)).toBe(DenialReason.ACCOUNT_DEACTIVATED);
  });
});

describe('editar una app', () => {
  it('en WORKSPACE_READ el invitado lee pero no edita', () => {
    const context = {
      actor: actor(GUEST),
      membership: membership(GUEST, WorkspaceRole.MEMBER),
      app: app({ accessLevel: AccessLevel.WORKSPACE_READ }),
    };
    expect(canViewApp(context).allowed).toBe(true);
    expect(reasonOf(canEditApp(context))).toBe(DenialReason.APP_IS_READ_ONLY);
  });

  it('en WORKSPACE_WRITE el invitado edita', () => {
    const decision = canEditApp({
      actor: actor(GUEST),
      membership: membership(GUEST, WorkspaceRole.MEMBER),
      app: app({ accessLevel: AccessLevel.WORKSPACE_WRITE }),
    });
    expect(decision.allowed).toBe(true);
  });

  it('una app archivada no se edita, ni siquiera por su precursor', () => {
    const decision = canEditApp({
      actor: actor(OWNER),
      membership: membership(OWNER),
      app: app({ archivedAt: new Date('2026-01-01') }),
    });
    expect(reasonOf(decision)).toBe(DenialReason.APP_IS_ARCHIVED);
  });
});

describe('comentar', () => {
  it('quien solo puede leer, puede comentar (RF-803)', () => {
    const context = {
      actor: actor(GUEST),
      membership: membership(GUEST, WorkspaceRole.MEMBER),
      app: app({ accessLevel: AccessLevel.WORKSPACE_READ }),
    };
    expect(reasonOf(canEditApp(context))).toBe(DenialReason.APP_IS_READ_ONLY);
    expect(canCommentOnApp(context).allowed).toBe(true);
  });

  it('quien no ve la app tampoco la comenta', () => {
    const decision = canCommentOnApp({
      actor: actor(GUEST),
      membership: membership(GUEST, WorkspaceRole.MEMBER),
      app: app(),
    });
    expect(reasonOf(decision)).toBe(DenialReason.APP_IS_PRIVATE);
  });

  it('una app archivada deja sus comentarios en solo lectura (RF-812)', () => {
    const decision = canCommentOnApp({
      actor: actor(OWNER),
      membership: membership(OWNER),
      app: app({ archivedAt: new Date('2026-01-01') }),
    });
    expect(reasonOf(decision)).toBe(DenialReason.APP_IS_ARCHIVED);
  });
});

describe('nivel de acceso', () => {
  it('el precursor que es dueño del workspace lo cambia', () => {
    const decision = canChangeAccessLevel({
      actor: actor(OWNER),
      membership: membership(OWNER),
      app: app(),
    });
    expect(decision.allowed).toBe(true);
  });

  it('el dueño del workspace no cambia el de una app ajena: no es su precursor', () => {
    const decision = canChangeAccessLevel({
      actor: actor(OWNER),
      membership: membership(OWNER),
      app: app({ precursorId: GUEST, accessLevel: AccessLevel.WORKSPACE_WRITE }),
    });
    expect(reasonOf(decision)).toBe(DenialReason.NOT_THE_PRECURSOR);
  });

  it('el invitado precursor tampoco lo cambia: su app queda fijada (D-9)', () => {
    const decision = canChangeAccessLevel({
      actor: actor(GUEST),
      membership: membership(GUEST, WorkspaceRole.MEMBER),
      app: app({ precursorId: GUEST, accessLevel: AccessLevel.WORKSPACE_WRITE }),
    });
    expect(reasonOf(decision)).toBe(DenialReason.ACCESS_LEVEL_IS_FIXED);
  });
});

describe('crear apps', () => {
  it('un invitado puede crear apps en el workspace ajeno (RF-401)', () => {
    const decision = canCreateApp({
      actor: actor(GUEST),
      membership: membership(GUEST, WorkspaceRole.MEMBER),
    });
    expect(decision.allowed).toBe(true);
  });

  it('quien no es miembro no crea nada', () => {
    expect(reasonOf(canCreateApp({ actor: actor(STRANGER), membership: null }))).toBe(
      DenialReason.NOT_A_MEMBER,
    );
  });

  it('el dueño elige el nivel de acceso de lo que crea', () => {
    expect(initialAccessLevel(WorkspaceRole.OWNER)).toBe(AccessLevel.PRIVATE);
    expect(initialAccessLevel(WorkspaceRole.OWNER, AccessLevel.WORKSPACE_READ)).toBe(
      AccessLevel.WORKSPACE_READ,
    );
  });

  it('lo que crea un invitado nace compartido y editable, pida lo que pida (D-9)', () => {
    expect(initialAccessLevel(WorkspaceRole.MEMBER)).toBe(AccessLevel.WORKSPACE_WRITE);
    expect(initialAccessLevel(WorkspaceRole.MEMBER, AccessLevel.PRIVATE)).toBe(
      AccessLevel.WORKSPACE_WRITE,
    );
  });
});
