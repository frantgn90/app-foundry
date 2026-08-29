import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import { type Anchor, reanchor } from '@app-foundry/core';
import { apps, commentThreads, documents, documentVersions, users } from '@app-foundry/db';

import { AuditAction, AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { currentTx } from '../database/request-context.js';
import type {
  ContributorDto,
  DiffDto,
  DocumentDto,
  SaveDocumentDto,
  VersionDetailDto,
  VersionSummaryDto,
} from './documents.dto.js';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Documento de visión de una app, con la versión sobre la que se edita. */
  async get(appId: string, userId: string): Promise<DocumentDto> {
    const [row] = await currentTx()
      .select({
        document: documents,
        versionNo: documentVersions.versionNo,
        app: apps,
      })
      .from(documents)
      .innerJoin(apps, eq(apps.id, documents.appId))
      .leftJoin(documentVersions, eq(documentVersions.id, documents.currentVersionId))
      .where(and(eq(documents.appId, appId), eq(documents.type, 'VISION')));

    if (!row) throw new NotFoundException('This app has no vision document');

    return {
      id: row.document.id,
      type: row.document.type,
      content: row.document.currentContent,
      currentVersionId: row.document.currentVersionId,
      versionNo: row.versionNo ?? 0,
      canEdit:
        row.app.archivedAt === null &&
        (row.app.precursorId === userId || row.app.accessLevel === 'WORKSPACE_WRITE'),
      updatedAt: row.document.updatedAt.toISOString(),
    };
  }

  /**
   * Guarda una versión nueva (RF-505, RF-511).
   *
   * `baseVersionId` es la versión desde la que se editó. Si mientras tanto
   * alguien guardó otra, se responde 409 con lo que hay ahora, para que la
   * interfaz pueda enseñar el conflicto en lugar de tragarse el trabajo ajeno.
   *
   * El documento se bloquea con `FOR UPDATE` antes de comparar: sin eso, dos
   * guardados que llegaran a la vez leerían la misma versión actual, ambos se
   * darían por buenos y el segundo pisaría al primero. Justamente lo que este
   * mecanismo existe para impedir.
   */
  async save(appId: string, body: SaveDocumentDto, userId: string): Promise<DocumentDto> {
    const tx = currentTx();

    // Se comprueba primero con permiso de lectura para poder distinguir «esto no
    // existe» de «esto existe pero no puedes escribirlo». Sin esta distinción,
    // a quien tiene la app en solo lectura se le respondería que su documento no
    // existe, cuando lo está viendo en pantalla.
    const readable = await this.get(appId, userId);
    if (!readable.canEdit) {
      throw new ForbiddenException('You can read this app but not edit it');
    }

    const [document] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.appId, appId), eq(documents.type, 'VISION')))
      .for('update');

    if (!document) throw new NotFoundException('This app has no vision document');

    if (document.currentVersionId !== body.baseVersionId) {
      throw new ConflictException(await this.conflictDetail(document.id, document.currentContent));
    }

    const [last] = await tx
      .select({ versionNo: documentVersions.versionNo })
      .from(documentVersions)
      .where(eq(documentVersions.documentId, document.id))
      .orderBy(desc(documentVersions.versionNo))
      .limit(1);

    const [version] = await tx
      .insert(documentVersions)
      .values({
        documentId: document.id,
        versionNo: (last?.versionNo ?? 0) + 1,
        content: body.content,
        authorId: userId,
        message: body.message ?? null,
      })
      .returning({ id: documentVersions.id, versionNo: documentVersions.versionNo });

    if (!version) throw new NotFoundException('The version could not be saved');

    await tx
      .update(documents)
      .set({
        currentVersionId: version.id,
        currentContent: body.content,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, document.id));

    // Los comentarios anclados se recolocan aquí, una vez por edición, en vez
    // de recalcularse en cada visita: se hace una sola vez y todo el mundo ve
    // el mismo resultado (TRD §9.3).
    await this.reanchorThreads(document.id, body.content);

    // La app también cambia de fecha: el listado ordena por actividad, y editar
    // la visión es la actividad más significativa que puede tener una app.
    await tx.update(apps).set({ updatedAt: new Date() }).where(eq(apps.id, appId));

    const contexto = await this.notifications.entornoDeApp(appId, userId);
    await this.notifications.emit({
      type: 'DOCUMENT_VERSION_SAVED',
      entorno: contexto.entorno,
      workspaceId: contexto.workspaceId,
      appId,
      payload: {
        actorHandle: contexto.actorHandle,
        appName: contexto.appName,
        versionNo: version.versionNo,
        // El mensaje del guardado, si lo hay: es lo que explica el cambio.
        message: body.message ?? null,
      },
    });

    await this.audit.record({
      actorId: userId,
      action: AuditAction.DOCUMENT_VERSION_CREATED,
      resourceType: 'document',
      resourceId: document.id,
      workspaceId: await this.workspaceOf(appId),
      // Se registra el número de versión, nunca su contenido (RF-706).
      metadata: { versionNo: version.versionNo },
    });

    return this.get(appId, userId);
  }

  /**
   * Recoloca los comentarios anclados sobre el contenido nuevo (RF-809).
   *
   * Un hilo huérfano también se reevalúa: si una edición posterior devuelve el
   * texto —al restaurar una versión, por ejemplo—, el comentario vuelve a su
   * sitio en lugar de quedarse descolgado para siempre.
   */
  private async reanchorThreads(documentId: string, content: string): Promise<void> {
    const tx = currentTx();

    const threads = await tx
      .select()
      .from(commentThreads)
      .where(and(eq(commentThreads.documentId, documentId), eq(commentThreads.kind, 'INLINE')));

    for (const thread of threads) {
      if (thread.anchorQuote === null) continue;

      const anchor: Anchor = {
        quote: thread.anchorQuote,
        prefix: thread.anchorPrefix ?? '',
        suffix: thread.anchorSuffix ?? '',
        start: thread.anchorStart ?? 0,
        end: thread.anchorEnd ?? 0,
      };

      const result = reanchor(anchor, content);
      await tx
        .update(commentThreads)
        .set({
          anchorStatus: result.status,
          anchorStart: result.start,
          anchorEnd: result.end,
        })
        .where(eq(commentThreads.id, thread.id));
    }
  }

  /** Historial completo, del más reciente al más antiguo (RF-507). */
  async versions(appId: string, userId: string): Promise<VersionSummaryDto[]> {
    // Se comprueba la visibilidad de la app para responder 404 igual que el
    // resto de rutas. Sin esto devolvería 200 con una lista vacía, y esa
    // diferencia de códigos entre rutas hermanas ya dice si algo existe.
    await this.get(appId, userId);

    const rows = await currentTx()
      .select({
        id: documentVersions.id,
        versionNo: documentVersions.versionNo,
        message: documentVersions.message,
        createdAt: documentVersions.createdAt,
        handle: users.handle,
        displayName: users.displayName,
      })
      .from(documentVersions)
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .innerJoin(users, eq(users.id, documentVersions.authorId))
      .where(eq(documents.appId, appId))
      .orderBy(desc(documentVersions.versionNo));

    return rows.map((r) => ({
      id: r.id,
      versionNo: r.versionNo,
      authorHandle: r.handle,
      authorDisplayName: r.displayName,
      message: r.message,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async version(appId: string, versionId: string): Promise<VersionDetailDto> {
    const [row] = await currentTx()
      .select({
        id: documentVersions.id,
        versionNo: documentVersions.versionNo,
        content: documentVersions.content,
        message: documentVersions.message,
        createdAt: documentVersions.createdAt,
        handle: users.handle,
        displayName: users.displayName,
      })
      .from(documentVersions)
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .innerJoin(users, eq(users.id, documentVersions.authorId))
      .where(and(eq(documents.appId, appId), eq(documentVersions.id, versionId)));

    if (!row) throw new NotFoundException('That version does not exist');

    return {
      id: row.id,
      versionNo: row.versionNo,
      content: row.content,
      authorHandle: row.handle,
      authorDisplayName: row.displayName,
      message: row.message,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * Dos versiones para comparar (RF-508).
   *
   * El servidor devuelve los dos contenidos y el cliente calcula las
   * diferencias: es una operación puramente visual, y hacerla aquí gastaría CPU
   * del servidor en algo que el navegador resuelve al instante (TRD §10).
   */
  async diff(appId: string, from: string, to: string): Promise<DiffDto> {
    // `version` ya comprueba pertenencia, así que basta con delegar.
    return {
      from: await this.version(appId, from),
      to: await this.version(appId, to),
    };
  }

  /**
   * Restaurar es guardar (RF-510).
   *
   * Se crea una versión nueva con el contenido antiguo, así que no se pierde
   * nada y el historial refleja quién restauró y cuándo.
   */
  async restore(appId: string, versionId: string, userId: string): Promise<DocumentDto> {
    const old = await this.version(appId, versionId);
    const current = await this.get(appId, userId);

    const restored = await this.save(
      appId,
      {
        content: old.content,
        baseVersionId: current.currentVersionId ?? '',
        message: `Restored version ${String(old.versionNo)}`,
      },
      userId,
    );

    await this.audit.record({
      actorId: userId,
      action: AuditAction.DOCUMENT_RESTORED,
      resourceType: 'document',
      resourceId: current.id,
      workspaceId: await this.workspaceOf(appId),
      metadata: { restoredFrom: old.versionNo },
    });

    return restored;
  }

  /**
   * Contribuidores derivados del historial (RF-509, D-8).
   *
   * No se conceden: es contribuidor quien ha escrito. El precursor queda fuera
   * porque ya se muestra aparte.
   */
  async contributors(appId: string, userId: string): Promise<ContributorDto[]> {
    await this.get(appId, userId);

    const rows = await currentTx()
      .select({
        userId: users.id,
        handle: users.handle,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
        versionCount: sql<number>`count(*)::int`,
      })
      .from(documentVersions)
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .innerJoin(users, eq(users.id, documentVersions.authorId))
      .innerJoin(apps, eq(apps.id, documents.appId))
      .where(
        and(eq(documents.appId, appId), sql`${documentVersions.authorId} <> ${apps.precursorId}`),
      )
      .groupBy(users.id, users.handle, users.displayName, users.avatarUrl);

    return rows;
  }

  /** `VISION.md` con su cabecera de metadatos (RF-512, T-18). */
  async exportMarkdown(appId: string, userId: string): Promise<{ filename: string; body: string }> {
    const [row] = await currentTx()
      .select({
        app: apps,
        content: documents.currentContent,
        versionNo: documentVersions.versionNo,
      })
      .from(documents)
      .innerJoin(apps, eq(apps.id, documents.appId))
      .leftJoin(documentVersions, eq(documentVersions.id, documents.currentVersionId))
      .where(and(eq(documents.appId, appId), eq(documents.type, 'VISION')));

    if (!row) throw new NotFoundException('This app has no vision document');

    const [author] = await currentTx()
      .select({ handle: users.handle })
      .from(users)
      .where(eq(users.id, userId));

    const frontMatter = [
      '---',
      `app: ${row.app.name}`,
      `status: ${row.app.status}`,
      `version: ${String(row.versionNo ?? 0)}`,
      `exported_by: ${author?.handle ?? 'unknown'}`,
      `exported_at: ${new Date().toISOString()}`,
      '---',
      '',
    ].join('\n');

    return { filename: 'VISION.md', body: frontMatter + row.content };
  }

  private async conflictDetail(documentId: string, currentContent: string) {
    const [latest] = await currentTx()
      .select({
        id: documentVersions.id,
        versionNo: documentVersions.versionNo,
        handle: users.handle,
      })
      .from(documentVersions)
      .innerJoin(users, eq(users.id, documentVersions.authorId))
      .where(eq(documentVersions.documentId, documentId))
      .orderBy(desc(documentVersions.versionNo))
      .limit(1);

    return {
      statusCode: 409,
      message: 'Someone else saved a new version while you were editing',
      currentContent,
      currentVersionId: latest?.id ?? null,
      currentVersionNo: latest?.versionNo ?? 0,
      lastAuthorHandle: latest?.handle ?? 'unknown',
    };
  }

  private async workspaceOf(appId: string): Promise<string> {
    const [row] = await currentTx()
      .select({ workspaceId: apps.workspaceId })
      .from(apps)
      .where(eq(apps.id, appId));
    if (!row) throw new NotFoundException('The app does not exist');
    return row.workspaceId;
  }
}
