import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';

import { type AccessLevel, defaultIcon, uniqueSlug, VISION_TEMPLATE } from '@app-foundry/core';
import {
  apps,
  appTags,
  documents,
  documentVersions,
  users,
  workspaceMembers,
  workspaces,
} from '@app-foundry/db';

import { AuditAction, AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { currentTx } from '../database/request-context.js';
import type { AppSummaryDto, CreateAppDto, UpdateAppDto } from './apps.dto.js';

@Injectable()
export class AppsService {
  constructor(
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Crea una app con su documento de visión ya listo (RF-401, RF-402).
   *
   * Todo en una transacción: una app sin documento sería un estado que la
   * interfaz no sabría representar. El nivel de acceso solicitado se ignora si
   * quien crea no es el dueño del workspace —la base de datos lo rechazaría de
   * todas formas (D-9)— y aquí se traduce a algo que no falla.
   */
  async create(workspaceId: string, body: CreateAppDto, userId: string): Promise<AppSummaryDto> {
    const tx = currentTx();

    const role = await this.roleIn(workspaceId, userId);
    if (role === null) throw new NotFoundException('The workspace does not exist');

    const requested = body.accessLevel ?? 'PRIVATE';
    const accessLevel: AccessLevel = role === 'OWNER' ? requested : 'WORKSPACE_WRITE';

    const taken = await tx
      .select({ slug: apps.slug })
      .from(apps)
      .where(eq(apps.workspaceId, workspaceId));

    const [created] = await tx
      .insert(apps)
      .values({
        workspaceId,
        slug: uniqueSlug(
          body.name,
          taken.map((t) => t.slug),
        ),
        name: body.name,
        shortDescription: body.shortDescription ?? null,
        accessLevel,
        precursorId: userId,
        // Marcador temporal: el icono definitivo depende del identificador, que
        // todavía no existe cuando se construye esta fila.
        iconEmoji: '💡',
        iconColor: 'slate',
      })
      .returning();

    if (!created) throw new NotFoundException('The app could not be created');

    const icon = defaultIcon(created.id);
    await tx
      .update(apps)
      .set({ iconEmoji: icon.emoji, iconColor: icon.color })
      .where(eq(apps.id, created.id));

    await this.createVisionDocument(created.id, userId);

    await this.audit.record({
      actorId: userId,
      action: AuditAction.APP_CREATED,
      resourceType: 'app',
      resourceId: created.id,
      workspaceId,
      metadata: { accessLevel },
    });

    return this.get(created.id, userId);
  }

  /** El documento nace con la plantilla y su primera versión (RF-503, RF-505). */
  private async createVisionDocument(appId: string, userId: string): Promise<void> {
    const tx = currentTx();

    const [document] = await tx
      .insert(documents)
      .values({ appId, type: 'VISION', currentContent: VISION_TEMPLATE })
      .returning({ id: documents.id });
    if (!document) throw new NotFoundException('The document could not be created');

    const [version] = await tx
      .insert(documentVersions)
      .values({
        documentId: document.id,
        versionNo: 1,
        content: VISION_TEMPLATE,
        authorId: userId,
        message: 'Initial version',
      })
      .returning({ id: documentVersions.id });

    await tx
      .update(documents)
      .set({ currentVersionId: version?.id ?? null })
      .where(eq(documents.id, document.id));
  }

  /**
   * Apps visibles de un workspace (RF-601).
   *
   * No filtra por permisos: la RLS ya devuelve solo lo que esta persona puede
   * ver, incluidas las privadas ajenas, que sencillamente no aparecen.
   */
  async list(workspaceId: string, userId: string): Promise<AppSummaryDto[]> {
    const rows = await currentTx()
      .select({
        app: apps,
        precursorHandle: users.handle,
        ownerId: workspaces.ownerId,
      })
      .from(apps)
      .innerJoin(users, eq(users.id, apps.precursorId))
      .innerJoin(workspaces, eq(workspaces.id, apps.workspaceId))
      .where(eq(apps.workspaceId, workspaceId))
      .orderBy(desc(apps.updatedAt));

    const tags = await this.tagsFor(rows.map((r) => r.app.id));
    return rows.map((r) => this.toSummary(r.app, r.precursorHandle, userId, tags));
  }

  async get(appId: string, userId: string): Promise<AppSummaryDto> {
    const [row] = await currentTx()
      .select({ app: apps, precursorHandle: users.handle })
      .from(apps)
      .innerJoin(users, eq(users.id, apps.precursorId))
      .where(eq(apps.id, appId));

    if (!row) throw new NotFoundException('The app does not exist');
    const tags = await this.tagsFor([appId]);
    return this.toSummary(row.app, row.precursorHandle, userId, tags);
  }

  async update(appId: string, body: UpdateAppDto, userId: string): Promise<AppSummaryDto> {
    const tx = currentTx();
    const workspaceId = await this.workspaceOf(appId);

    const changes: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) changes['name'] = body.name;
    if (body.shortDescription !== undefined) changes['shortDescription'] = body.shortDescription;
    if (body.status !== undefined) changes['status'] = body.status;
    if (body.repoUrl !== undefined) changes['repoUrl'] = body.repoUrl;
    if (body.iconEmoji !== undefined) changes['iconEmoji'] = body.iconEmoji;
    if (body.iconColor !== undefined) changes['iconColor'] = body.iconColor;

    const updated = await tx.update(apps).set(changes).where(eq(apps.id, appId)).returning();
    // La RLS deja pasar la sentencia pero no afecta a ninguna fila cuando no se
    // puede editar: sin esta comprobación, la respuesta diría que todo fue bien.
    if (updated.length === 0) {
      throw new ForbiddenException('You cannot edit this app');
    }

    if (body.tags !== undefined) {
      await tx.delete(appTags).where(eq(appTags.appId, appId));
      if (body.tags.length > 0) {
        await tx.insert(appTags).values(body.tags.map((tag) => ({ appId, tag })));
      }
    }

    await this.audit.record({
      actorId: userId,
      action: AuditAction.APP_UPDATED,
      resourceType: 'app',
      resourceId: appId,
      workspaceId,
      metadata: { fields: Object.keys(changes).filter((k) => k !== 'updatedAt') },
    });

    return this.get(appId, userId);
  }

  /**
   * Cambia el nivel de acceso (RF-406).
   *
   * La comprobación de fondo la hace un trigger en la base de datos: solo el
   * precursor que además es dueño del workspace. Aquí se traduce ese rechazo a
   * una respuesta que la interfaz pueda explicar.
   */
  async changeAccessLevel(
    appId: string,
    accessLevel: AccessLevel,
    userId: string,
  ): Promise<AppSummaryDto> {
    const workspaceId = await this.workspaceOf(appId);

    let changed: unknown[];
    try {
      changed = await currentTx()
        .update(apps)
        .set({ accessLevel, updatedAt: new Date() })
        .where(eq(apps.id, appId))
        .returning({ id: apps.id });
    } catch (error) {
      throw new ForbiddenException(
        'Only the precursor, when they also own the workspace, can change this',
        { cause: error },
      );
    }

    // La RLS no lanza: deja pasar la sentencia y no toca ninguna fila. Sin esta
    // comprobación responderíamos 200 sin haber cambiado nada, que es la peor
    // forma de fallar.
    if (changed.length === 0) {
      throw new ForbiddenException('You cannot change the access level of this app');
    }

    await this.audit.record({
      actorId: userId,
      action: AuditAction.APP_ACCESS_LEVEL_CHANGED,
      resourceType: 'app',
      resourceId: appId,
      workspaceId,
      metadata: { accessLevel },
    });

    return this.get(appId, userId);
  }

  /** Archivar deja la app en solo lectura, sin borrar nada (RF-409). */
  async setArchived(appId: string, archived: boolean, userId: string): Promise<AppSummaryDto> {
    const workspaceId = await this.workspaceOf(appId);
    const app = await this.get(appId, userId);
    if (!app.isPrecursor) throw new ForbiddenException('Only the precursor can archive this app');

    const changed = await currentTx()
      .update(apps)
      .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
      .where(eq(apps.id, appId))
      .returning({ id: apps.id });

    if (changed.length === 0) {
      throw new ForbiddenException('You cannot archive or unarchive this app');
    }

    await this.audit.record({
      actorId: userId,
      action: archived ? AuditAction.APP_ARCHIVED : AuditAction.APP_UNARCHIVED,
      resourceType: 'app',
      resourceId: appId,
      workspaceId,
    });

    return this.get(appId, userId);
  }

  /**
   * Elimina la app y todo su historial (RF-411).
   *
   * La auditoría se registra **antes** del borrado: después, la app ya no
   * existe y el registro se quedaría sin poder decir de qué habla.
   */
  async remove(appId: string, userId: string): Promise<void> {
    const workspaceId = await this.workspaceOf(appId);
    const app = await this.get(appId, userId);
    if (!app.isPrecursor) throw new ForbiddenException('Only the precursor can delete this app');

    await this.audit.record({
      actorId: userId,
      action: AuditAction.APP_DELETED,
      resourceType: 'app',
      resourceId: appId,
      workspaceId,
      metadata: { name: app.name, slug: app.slug },
    });

    await currentTx().delete(apps).where(eq(apps.id, appId));
  }

  /**
   * Transfiere el rol de precursor (RF-408).
   *
   * Recibirlo no otorga permiso para crear apps nuevas: son cosas distintas.
   */
  async transferPrecursor(appId: string, toUserId: string, userId: string): Promise<AppSummaryDto> {
    const workspaceId = await this.workspaceOf(appId);
    const app = await this.get(appId, userId);
    if (!app.isPrecursor) throw new ForbiddenException('Only the precursor can transfer this role');

    const role = await this.roleIn(workspaceId, toUserId);
    if (role === null) {
      throw new NotFoundException('That person is not a member of this workspace');
    }

    const changed = await currentTx()
      .update(apps)
      .set({ precursorId: toUserId, updatedAt: new Date() })
      .where(eq(apps.id, appId))
      .returning({ id: apps.id });

    if (changed.length === 0) {
      throw new ForbiddenException('You cannot transfer this app');
    }

    const contexto = await this.notifications.entornoDeApp(appId, userId);
    await this.notifications.emit({
      type: 'PRECURSOR_TRANSFERRED',
      entorno: { actor: userId, destinatario: toUserId },
      workspaceId,
      appId,
      payload: { actorHandle: contexto.actorHandle, appName: contexto.appName },
    });

    await this.audit.record({
      actorId: userId,
      action: AuditAction.APP_PRECURSOR_TRANSFERRED,
      resourceType: 'app',
      resourceId: appId,
      workspaceId,
      metadata: { to: toUserId },
    });

    return this.get(appId, userId);
  }

  /** El workspace de una app, para poder atribuirle sus eventos de auditoría. */
  private async workspaceOf(appId: string): Promise<string> {
    const [row] = await currentTx()
      .select({ workspaceId: apps.workspaceId })
      .from(apps)
      .where(eq(apps.id, appId));
    if (!row) throw new NotFoundException('The app does not exist');
    return row.workspaceId;
  }

  private async tagsFor(appIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (appIds.length === 0) return map;

    const rows = await currentTx()
      .select({ appId: appTags.appId, tag: appTags.tag })
      .from(appTags)
      .where(inArray(appTags.appId, appIds));

    for (const row of rows) {
      map.set(row.appId, [...(map.get(row.appId) ?? []), row.tag]);
    }
    return map;
  }

  private async roleIn(workspaceId: string, userId: string): Promise<'OWNER' | 'MEMBER' | null> {
    const [row] = await currentTx()
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)),
      );
    return row?.role ?? null;
  }

  private toSummary(
    app: typeof apps.$inferSelect,
    precursorHandle: string,
    userId: string,
    tags: Map<string, string[]>,
  ): AppSummaryDto {
    const isPrecursor = app.precursorId === userId;
    return {
      id: app.id,
      slug: app.slug,
      name: app.name,
      shortDescription: app.shortDescription,
      status: app.status,
      accessLevel: app.accessLevel,
      icon: { emoji: app.iconEmoji, color: app.iconColor },
      tags: tags.get(app.id) ?? [],
      repoUrl: app.repoUrl,
      precursorHandle,
      isPrecursor,
      canEdit: app.archivedAt === null && (isPrecursor || app.accessLevel === 'WORKSPACE_WRITE'),
      isArchived: app.archivedAt !== null,
      updatedAt: app.updatedAt.toISOString(),
    };
  }
}
