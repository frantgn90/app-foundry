import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';

import { type Anchor, reanchor } from '@app-foundry/core';
import {
  apps,
  commentThreads,
  documents,
  documentVersionCoauthors,
  documentVersions,
  documentWorkingAuthors,
  users,
} from '@app-foundry/db';

import { AuditAction, AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { MetricsService } from '../observability/metrics.service.js';
import { currentTx } from '@app-foundry/ai-runtime';
import type {
  CommitDocumentDto,
  ContributorDto,
  DiffDto,
  DocumentDto,
  ResetDocumentDto,
  SaveDocumentDto,
  VersionDetailDto,
  VersionSummaryDto,
} from './documents.dto.js';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Documento de visión: la copia de trabajo y en qué versión se apoya.
   *
   * «Hay cambios sin commitear» no es un campo que haya que mantener al día: es
   * que la copia de trabajo ya no dice lo mismo que su versión. Se compara aquí
   * y no puede desincronizarse de la realidad.
   */
  async get(appId: string, userId: string): Promise<DocumentDto> {
    const [row] = await currentTx()
      .select({
        document: documents,
        versionNo: documentVersions.versionNo,
        versionContent: documentVersions.content,
        app: apps,
      })
      .from(documents)
      .innerJoin(apps, eq(apps.id, documents.appId))
      .leftJoin(documentVersions, eq(documentVersions.id, documents.currentVersionId))
      .where(and(eq(documents.appId, appId), eq(documents.type, 'VISION')));

    if (!row) throw new NotFoundException('This app has no vision document');

    const escritores = await currentTx()
      .select({ handle: users.handle, displayName: users.displayName })
      .from(documentWorkingAuthors)
      .innerJoin(users, eq(users.id, documentWorkingAuthors.userId))
      .where(eq(documentWorkingAuthors.documentId, row.document.id))
      .orderBy(documentWorkingAuthors.savedAt);

    return {
      id: row.document.id,
      type: row.document.type,
      content: row.document.currentContent,
      currentVersionId: row.document.currentVersionId,
      versionNo: row.versionNo ?? 0,
      revision: row.document.revision,
      uncommittedChanges: row.document.currentContent !== (row.versionContent ?? ''),
      aiSeeded: row.document.aiSeeded,
      workingAuthors: escritores,
      canEdit:
        row.app.archivedAt === null &&
        (row.app.precursorId === userId || row.app.accessLevel === 'WORKSPACE_WRITE'),
      updatedAt: row.document.updatedAt.toISOString(),
    };
  }

  /**
   * Guarda en la copia de trabajo (RF-505, RF-511).
   *
   * Guardar ya no crea versión: escribe lo que hay en el documento y lo deja
   * ahí, tantas veces como haga falta. La versión la crea `commit`, que es
   * cuando alguien decide que lo escrito ya es algo.
   *
   * `revision` es lo que protege de pisarse: sube en cada guardado, así que dos
   * personas editando a la vez no comparten revisión aunque compartan versión.
   * Antes se usaba la versión actual para esto, y ahora dos guardados seguidos
   * la comparten: no distinguiría nada.
   *
   * El documento se bloquea con `FOR UPDATE` antes de comparar: sin eso, dos
   * guardados que llegaran a la vez leerían la misma revisión, ambos se darían
   * por buenos y el segundo pisaría al primero.
   */
  async save(appId: string, body: SaveDocumentDto, userId: string): Promise<DocumentDto> {
    const document = await this.lockForWrite(appId, userId, body.revision);

    // Guardar lo mismo que ya hay no es guardar: ni sube revisión, ni apunta a
    // nadie como autor de un cambio que no existe.
    if (document.currentContent === body.content) return this.get(appId, userId);

    const tx = currentTx();

    await tx
      .update(documents)
      .set({
        currentContent: body.content,
        revision: document.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, document.id));

    const versionActual = await this.currentVersionContent(document);

    if (body.content === versionActual) {
      // Se ha vuelto al texto de la versión escribiendo, no descartando: la
      // copia de trabajo está limpia otra vez y no hay coautoría que registrar.
      await tx
        .delete(documentWorkingAuthors)
        .where(eq(documentWorkingAuthors.documentId, document.id));
    } else {
      await tx
        .insert(documentWorkingAuthors)
        .values({ documentId: document.id, userId })
        .onConflictDoNothing();
    }

    // Los comentarios anclados se recolocan aquí, una vez por guardado, en vez
    // de recalcularse en cada visita: se hace una sola vez y todo el mundo ve
    // el mismo resultado (TRD §9.3).
    await this.reanchorWorking(document.id, document.currentVersionId, body.content);

    // La app también cambia de fecha: el listado ordena por actividad, y editar
    // la visión es la actividad más significativa que puede tener una app.
    await tx.update(apps).set({ updatedAt: new Date() }).where(eq(apps.id, appId));

    return this.get(appId, userId);
  }

  /**
   * Convierte la copia de trabajo en una versión inmutable (RF-505, RF-516).
   *
   * Es el acto que da nombre a lo escrito, y por eso el mensaje es obligatorio.
   * Commitear sin cambios se rechaza: una versión idéntica a la anterior no
   * cuenta nada y ensucia el historial, que es justo lo que se venía a arreglar.
   */
  async commit(appId: string, body: CommitDocumentDto, userId: string): Promise<DocumentDto> {
    const document = await this.lockForWrite(appId, userId, body.revision);
    const tx = currentTx();

    if (document.currentContent === (await this.currentVersionContent(document))) {
      throw new BadRequestException('There is nothing to commit');
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
        content: document.currentContent,
        authorId: userId,
        message: body.message,
      })
      .returning({ id: documentVersions.id, versionNo: documentVersions.versionNo });

    if (!version) throw new NotFoundException('The version could not be created');

    /*
     * Quien escribió sin commitear queda como coautor (RF-516). Se hace antes de
     * vaciar la lista de trabajo a propósito: la política que gobierna esta
     * tabla exige que la fila siga ahí, de modo que nadie pueda atribuir una
     * versión a quien no la tocó.
     */
    const coautores = await tx
      .select({ userId: documentWorkingAuthors.userId })
      .from(documentWorkingAuthors)
      .where(
        and(
          eq(documentWorkingAuthors.documentId, document.id),
          ne(documentWorkingAuthors.userId, userId),
        ),
      );

    if (coautores.length > 0) {
      await tx
        .insert(documentVersionCoauthors)
        .values(coautores.map((c) => ({ versionId: version.id, userId: c.userId })));
    }

    await tx
      .delete(documentWorkingAuthors)
      .where(eq(documentWorkingAuthors.documentId, document.id));

    await tx
      .update(documents)
      .set({
        currentVersionId: version.id,
        revision: document.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, document.id));

    /*
     * Los hilos de la versión que acaba de quedarse atrás se congelan: su ancla
     * ya es exacta sobre su propio texto, que no va a cambiar nunca más. La
     * posición de trabajo era el puente entre versión y copia de trabajo, y ese
     * puente ya no lleva a ningún sitio.
     */
    await tx
      .update(commentThreads)
      .set({ workingStart: null, workingEnd: null, workingStatus: null })
      .where(eq(commentThreads.documentId, document.id));

    this.metrics.versionGuardada();

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
        message: body.message,
      },
    });

    await this.audit.record({
      actorId: userId,
      action: AuditAction.DOCUMENT_VERSION_CREATED,
      resourceType: 'document',
      resourceId: document.id,
      workspaceId: await this.workspaceOf(appId),
      // Se registra el número de versión, nunca su contenido (RF-706).
      metadata: { versionNo: version.versionNo, coauthors: coautores.length },
    });

    return this.get(appId, userId);
  }

  /**
   * Descarta los cambios sin commitear (RF-515).
   *
   * Es la única operación que pierde trabajo de verdad: lo descartado no queda
   * en ninguna versión porque nunca llegó a ser una. Por eso queda en auditoría
   * —quién lo hizo y cuándo— aunque el contenido no se guarde en ningún sitio.
   */
  async reset(appId: string, body: ResetDocumentDto, userId: string): Promise<DocumentDto> {
    const document = await this.lockForWrite(appId, userId, body.revision);
    const tx = currentTx();
    const versionActual = await this.currentVersionContent(document);

    if (document.currentContent === versionActual) {
      throw new BadRequestException('There is nothing to discard');
    }

    await tx
      .update(documents)
      .set({
        currentContent: versionActual,
        revision: document.revision + 1,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, document.id));

    await tx
      .delete(documentWorkingAuthors)
      .where(eq(documentWorkingAuthors.documentId, document.id));

    /*
     * Los hilos vuelven a su sitio de golpe, huérfanos incluidos: la copia de
     * trabajo vuelve a ser la versión, y sobre su versión el ancla de un hilo
     * siempre es exacta. No hay nada que buscar.
     */
    await tx
      .update(commentThreads)
      .set({
        workingStart: sql`${commentThreads.anchorStart}`,
        workingEnd: sql`${commentThreads.anchorEnd}`,
        workingStatus: sql`${commentThreads.anchorStatus}`,
      })
      .where(eq(commentThreads.documentId, document.id));

    await this.audit.record({
      actorId: userId,
      action: AuditAction.DOCUMENT_RESET,
      resourceType: 'document',
      resourceId: document.id,
      workspaceId: await this.workspaceOf(appId),
      metadata: { versionNo: (await this.get(appId, userId)).versionNo },
    });

    return this.get(appId, userId);
  }

  /**
   * Bloquea el documento y comprueba permiso y revisión.
   *
   * Lo comparten guardar, commitear y descartar porque las tres escriben sobre
   * la copia de trabajo: si dos llegan a la vez, la segunda tiene que enterarse
   * de que lo que tenía delante ya no está.
   */
  private async lockForWrite(appId: string, userId: string, revision: number) {
    // Se comprueba primero con permiso de lectura para poder distinguir «esto no
    // existe» de «esto existe pero no puedes escribirlo». Sin esta distinción,
    // a quien tiene la app en solo lectura se le respondería que su documento no
    // existe, cuando lo está viendo en pantalla.
    const readable = await this.get(appId, userId);
    if (!readable.canEdit) {
      throw new ForbiddenException('You can read this app but not edit it');
    }

    const [document] = await currentTx()
      .select()
      .from(documents)
      .where(and(eq(documents.appId, appId), eq(documents.type, 'VISION')))
      .for('update');

    if (!document) throw new NotFoundException('This app has no vision document');

    if (document.revision !== revision) {
      throw new ConflictException(await this.conflictDetail(document));
    }

    return document;
  }

  /** El texto de la versión actual, que es contra lo que se mide «sin commitear». */
  private async currentVersionContent(document: { currentVersionId: string | null }) {
    if (!document.currentVersionId) return '';
    const [version] = await currentTx()
      .select({ content: documentVersions.content })
      .from(documentVersions)
      .where(eq(documentVersions.id, document.currentVersionId));
    return version?.content ?? '';
  }

  /**
   * Recoloca sobre la copia de trabajo los hilos de la versión actual (RF-809).
   *
   * Solo se toca la posición **de trabajo**: la de la versión es inmutable como
   * ella, y sobre su propio texto siempre es exacta. Lo que se calcula aquí es
   * dónde cae ese fragmento en un texto que ya no es el suyo.
   *
   * Solo los hilos de la versión actual: los de versiones anteriores se leen
   * sobre su propio texto, donde no hay nada que recolocar.
   *
   * Un hilo huérfano se reevalúa igual: si una edición posterior devuelve el
   * texto, el comentario vuelve a su sitio en lugar de quedarse descolgado.
   */
  private async reanchorWorking(
    documentId: string,
    versionId: string | null,
    content: string,
  ): Promise<void> {
    if (!versionId) return;
    const tx = currentTx();

    const threads = await tx
      .select()
      .from(commentThreads)
      .where(
        and(
          eq(commentThreads.documentId, documentId),
          eq(commentThreads.kind, 'INLINE'),
          eq(commentThreads.anchoredVersionId, versionId),
        ),
      );

    // Se cuentan las que se quedan sin sitio en esta edición, no las que ya
    // estaban huérfanas: lo que interesa vigilar es si el reanclaje empieza a
    // fallar, y para eso hace falta el cambio, no el total acumulado.
    let nuevasHuerfanas = 0;

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
      if (result.status === 'ORPHANED' && thread.workingStatus !== 'ORPHANED') nuevasHuerfanas += 1;

      await tx
        .update(commentThreads)
        .set({
          workingStatus: result.status,
          workingStart: result.start,
          workingEnd: result.end,
        })
        .where(eq(commentThreads.id, thread.id));
    }

    this.metrics.anclasHuerfanas(nuevasHuerfanas);
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

    const coautores = await this.coauthorsOf(rows.map((r) => r.id));

    return rows.map((r) => ({
      id: r.id,
      versionNo: r.versionNo,
      authorHandle: r.handle,
      authorDisplayName: r.displayName,
      coauthorHandles: coautores.get(r.id) ?? [],
      message: r.message,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Coautores por versión, en una consulta para toda la lista (RF-516). */
  private async coauthorsOf(versionIds: string[]): Promise<Map<string, string[]>> {
    const porVersion = new Map<string, string[]>();
    if (versionIds.length === 0) return porVersion;

    const rows = await currentTx()
      .select({ versionId: documentVersionCoauthors.versionId, handle: users.handle })
      .from(documentVersionCoauthors)
      .innerJoin(users, eq(users.id, documentVersionCoauthors.userId))
      .where(inArray(documentVersionCoauthors.versionId, versionIds));

    for (const row of rows) {
      porVersion.set(row.versionId, [...(porVersion.get(row.versionId) ?? []), row.handle]);
    }
    return porVersion;
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

    const coautores = await this.coauthorsOf([row.id]);

    return {
      id: row.id,
      versionNo: row.versionNo,
      content: row.content,
      authorHandle: row.handle,
      authorDisplayName: row.displayName,
      coauthorHandles: coautores.get(row.id) ?? [],
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
   * Deja el texto antiguo en la copia de trabajo, sin crear versión: quien
   * restaura puede leerlo, compararlo, seguir editándolo y después commitearlo
   * con su mensaje —o descartarlo, si al verlo entero cambia de idea—. Volver
   * atrás deja de ser un acto a ciegas.
   */
  async restore(appId: string, versionId: string, userId: string): Promise<DocumentDto> {
    const old = await this.version(appId, versionId);
    const current = await this.get(appId, userId);

    const restored = await this.save(
      appId,
      { content: old.content, revision: current.revision },
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
   * No se conceden: es contribuidor quien ha escrito. Cuentan igual el autor de
   * la versión y sus coautores (RF-516): quien escribió el texto y dejó que otro
   * lo commiteara escribió lo mismo. El precursor queda fuera porque ya se
   * muestra aparte.
   */
  async contributors(appId: string, userId: string): Promise<ContributorDto[]> {
    await this.get(appId, userId);

    const rows = await currentTx().execute(sql`
      SELECT u.id            AS "userId",
             u.handle        AS "handle",
             u.display_name  AS "displayName",
             u.avatar_url    AS "avatarUrl",
             count(*)::int   AS "versionCount"
      FROM (
        SELECT v.id AS version_id, v.author_id AS user_id
        FROM document_versions v
        JOIN documents d ON d.id = v.document_id
        WHERE d.app_id = ${appId}
        UNION
        SELECT c.version_id, c.user_id
        FROM document_version_coauthors c
        JOIN document_versions v ON v.id = c.version_id
        JOIN documents d ON d.id = v.document_id
        WHERE d.app_id = ${appId}
      ) escrituras
      JOIN users u ON u.id = escrituras.user_id
      JOIN apps a ON a.id = ${appId}
      WHERE escrituras.user_id <> a.precursor_id
      GROUP BY u.id, u.handle, u.display_name, u.avatar_url
    `);

    return rows.rows as unknown as ContributorDto[];
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

  /**
   * Qué contarle a quien se ha encontrado el documento cambiado (RF-511).
   *
   * No basta con decir que falló: se enseña quién escribió y qué hay ahora,
   * porque lo que hay que decidir es si el texto propio sigue teniendo sentido
   * encima del ajeno.
   *
   * Quien escribió es el último que guardó, que ya no tiene por qué ser el autor
   * de ninguna versión: puede llevar toda la tarde guardando sin commitear.
   */
  private async conflictDetail(document: {
    id: string;
    currentContent: string;
    revision: number;
    currentVersionId: string | null;
  }) {
    const [ultimoGuardado] = await currentTx()
      .select({ handle: users.handle })
      .from(documentWorkingAuthors)
      .innerJoin(users, eq(users.id, documentWorkingAuthors.userId))
      .where(eq(documentWorkingAuthors.documentId, document.id))
      .orderBy(desc(documentWorkingAuthors.savedAt))
      .limit(1);

    const [latest] = await currentTx()
      .select({
        id: documentVersions.id,
        versionNo: documentVersions.versionNo,
        handle: users.handle,
      })
      .from(documentVersions)
      .innerJoin(users, eq(users.id, documentVersions.authorId))
      .where(eq(documentVersions.documentId, document.id))
      .orderBy(desc(documentVersions.versionNo))
      .limit(1);

    return {
      statusCode: 409,
      message: 'Someone else saved while you were editing',
      currentContent: document.currentContent,
      currentVersionId: latest?.id ?? null,
      currentVersionNo: latest?.versionNo ?? 0,
      revision: document.revision,
      lastAuthorHandle: ultimoGuardado?.handle ?? latest?.handle ?? 'unknown',
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
