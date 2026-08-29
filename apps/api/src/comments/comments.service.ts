import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';

import { createAnchor, extractMentions } from '@app-foundry/core';
import {
  apps,
  commentMentions,
  comments,
  commentThreads,
  documents,
  users,
  workspaceMembers,
} from '@app-foundry/db';

import { AuditAction, AuditService } from '../audit/audit.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { currentTx } from '../database/request-context.js';
import type {
  CommentDto,
  CreateCommentDto,
  CreateThreadDto,
  MentionableUserDto,
  ThreadDto,
} from './comments.dto.js';

@Injectable()
export class CommentsService {
  constructor(
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Hilos de una app, con sus comentarios.
   *
   * Se devuelven todos —abiertos, resueltos y huérfanos— y es la interfaz quien
   * decide qué enseña por defecto: un hilo resuelto sigue siendo parte de la
   * conversación y a veces hay que volver a él (RF-807).
   */
  async list(appId: string, userId: string): Promise<ThreadDto[]> {
    const tx = currentTx();

    const [app] = await tx
      .select({ precursorId: apps.precursorId })
      .from(apps)
      .where(eq(apps.id, appId));
    if (!app) throw new NotFoundException('The app does not exist');

    const threads = await tx
      .select({
        thread: commentThreads,
        resolvedByHandle: users.handle,
      })
      .from(commentThreads)
      .leftJoin(users, eq(users.id, commentThreads.resolvedBy))
      .where(eq(commentThreads.appId, appId))
      .orderBy(asc(commentThreads.createdAt));

    if (threads.length === 0) return [];

    const rows = await tx
      .select({
        comment: comments,
        handle: users.handle,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(
        inArray(
          comments.threadId,
          threads.map((t) => t.thread.id),
        ),
      )
      .orderBy(asc(comments.createdAt));

    const mentions = await this.mentionsFor(rows.map((r) => r.comment.id));

    return threads.map(({ thread, resolvedByHandle }) => ({
      id: thread.id,
      kind: thread.kind,
      status: thread.status,
      anchorStatus: thread.anchorStatus,
      anchorQuote: thread.anchorQuote,
      anchorStart: thread.anchorStart,
      anchorEnd: thread.anchorEnd,
      resolvedByHandle,
      // Borrar el hilo entero: su autor o el precursor de la app (RF-806).
      canDelete: thread.createdBy === userId || app.precursorId === userId,
      comments: rows
        .filter((r) => r.comment.threadId === thread.id)
        .map((r) => this.toComment(r, userId, mentions)),
      createdAt: thread.createdAt.toISOString(),
    }));
  }

  /**
   * Abre un hilo, general o anclado a un fragmento.
   *
   * El ancla se calcula aquí y no se acepta del cliente: la posición y el
   * contexto deben salir del contenido que el servidor tiene guardado, no de lo
   * que diga el navegador.
   */
  async createThread(appId: string, body: CreateThreadDto, userId: string): Promise<ThreadDto> {
    const tx = currentTx();

    const [document] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.appId, appId), eq(documents.type, 'VISION')));
    if (!document) throw new NotFoundException('This app has no vision document');

    const isInline = body.quote !== undefined && body.start !== undefined && body.end !== undefined;
    const anchor = isInline
      ? createAnchor(document.currentContent, body.start ?? 0, body.end ?? 0)
      : null;

    // Si dice ser inline pero el fragmento no cuadra con el documento, es que
    // el cliente y el servidor no están mirando el mismo texto.
    if (isInline && (!anchor || anchor.quote !== body.quote)) {
      throw new ForbiddenException('That fragment no longer matches the document');
    }

    const [thread] = await tx
      .insert(commentThreads)
      .values({
        appId,
        documentId: document.id,
        kind: anchor ? 'INLINE' : 'GENERAL',
        createdBy: userId,
        ...(anchor
          ? {
              anchorQuote: anchor.quote,
              anchorPrefix: anchor.prefix,
              anchorSuffix: anchor.suffix,
              anchorStart: anchor.start,
              anchorEnd: anchor.end,
              anchoredVersionId: document.currentVersionId,
              anchorStatus: 'ANCHORED' as const,
            }
          : {}),
      })
      .returning({ id: commentThreads.id });

    if (!thread) throw new ForbiddenException('You cannot comment on this app');

    const { mencionados } = await this.insertComment(thread.id, body.body, null, userId);

    const entorno = await this.notifications.entornoDeApp(appId, userId);
    await this.notifications.emit({
      type: 'APP_COMMENTED',
      entorno: { ...entorno.entorno, mencionados },
      workspaceId: entorno.workspaceId,
      appId,
      threadId: thread.id,
      payload: {
        actorHandle: entorno.actorHandle,
        appName: entorno.appName,
        excerpt: extracto(body.body),
      },
    });

    await this.audit.record({
      actorId: userId,
      action: AuditAction.COMMENT_THREAD_CREATED,
      resourceType: 'thread',
      resourceId: thread.id,
      workspaceId: await this.workspaceOf(appId),
      // El tipo de hilo, nunca su contenido (RF-706).
      metadata: { kind: anchor ? 'INLINE' : 'GENERAL' },
    });

    const threads = await this.list(appId, userId);
    return threads.find((t) => t.id === thread.id) ?? threads[threads.length - 1]!;
  }

  async reply(threadId: string, body: CreateCommentDto, userId: string): Promise<CommentDto> {
    const [thread] = await currentTx()
      .select({ appId: commentThreads.appId, autor: commentThreads.createdBy })
      .from(commentThreads)
      .where(eq(commentThreads.id, threadId));
    if (!thread) throw new NotFoundException('That thread does not exist');

    const { comment, mencionados } = await this.insertComment(
      threadId,
      body.body,
      body.parentId ?? null,
      userId,
    );

    const contexto = await this.notifications.entornoDeApp(thread.appId, userId);
    await this.notifications.emit({
      type: 'THREAD_REPLIED',
      entorno: {
        actor: userId,
        autorDelHilo: thread.autor,
        participantesDelHilo: await this.participantesDelHilo(threadId),
        mencionados,
      },
      workspaceId: contexto.workspaceId,
      appId: thread.appId,
      threadId,
      payload: {
        actorHandle: contexto.actorHandle,
        appName: contexto.appName,
        excerpt: extracto(body.body),
      },
    });

    return comment;
  }

  async edit(commentId: string, body: string, userId: string): Promise<CommentDto> {
    const tx = currentTx();

    const updated = await tx
      .update(comments)
      .set({ body, editedAt: new Date() })
      .where(eq(comments.id, commentId))
      .returning({ id: comments.id, threadId: comments.threadId });

    // La RLS deja pasar la sentencia sin tocar filas cuando el comentario no es
    // tuyo: sin comprobarlo, responderíamos que se guardó.
    if (updated.length === 0) {
      throw new ForbiddenException('You can only edit your own comments');
    }

    // Editar no vuelve a avisar: el aviso ya salió cuando se escribió. Sí se
    // rehacen las menciones, porque el texto puede haber cambiado a quién señala.
    await this.syncMentions(commentId, body, userId);
    return this.comment(commentId, userId);
  }

  /** Borrado lógico: el hilo conserva su forma y las respuestas su sitio. */
  async remove(commentId: string): Promise<void> {
    const updated = await currentTx()
      .update(comments)
      .set({ deletedAt: new Date() })
      .where(eq(comments.id, commentId))
      .returning({ id: comments.id });

    if (updated.length === 0) {
      throw new ForbiddenException('You can only delete your own comments');
    }
  }

  /** Resolver y reabrir, dejando constancia de quién (RF-807). */
  async setResolved(threadId: string, resolved: boolean, userId: string): Promise<ThreadDto> {
    const tx = currentTx();

    const updated = await tx
      .update(commentThreads)
      .set(
        resolved
          ? { status: 'RESOLVED', resolvedBy: userId, resolvedAt: new Date() }
          : { status: 'OPEN', reopenedBy: userId, reopenedAt: new Date() },
      )
      .where(eq(commentThreads.id, threadId))
      .returning({ appId: commentThreads.appId, autor: commentThreads.createdBy });

    if (updated.length === 0) {
      throw new ForbiddenException('You cannot change this thread');
    }

    const appId = updated[0]!.appId;

    // Solo se avisa al cerrar. Reabrir es en la práctica seguir hablando, y de
    // eso ya avisa la respuesta que casi siempre viene detrás.
    if (resolved) {
      const contexto = await this.notifications.entornoDeApp(appId, userId);
      await this.notifications.emit({
        type: 'THREAD_RESOLVED',
        entorno: { actor: userId, autorDelHilo: updated[0]!.autor },
        workspaceId: contexto.workspaceId,
        appId,
        threadId,
        payload: { actorHandle: contexto.actorHandle, appName: contexto.appName },
      });
    }

    await this.audit.record({
      actorId: userId,
      action: resolved ? AuditAction.COMMENT_THREAD_RESOLVED : AuditAction.COMMENT_THREAD_REOPENED,
      resourceType: 'thread',
      resourceId: threadId,
      workspaceId: await this.workspaceOf(appId),
    });

    const threads = await this.list(appId, userId);
    const thread = threads.find((t) => t.id === threadId);
    if (!thread) throw new NotFoundException('That thread does not exist');
    return thread;
  }

  async removeThread(threadId: string, userId: string): Promise<void> {
    const tx = currentTx();
    const [thread] = await tx
      .select({ appId: commentThreads.appId })
      .from(commentThreads)
      .where(eq(commentThreads.id, threadId));
    if (!thread) throw new NotFoundException('That thread does not exist');

    const deleted = await tx
      .delete(commentThreads)
      .where(eq(commentThreads.id, threadId))
      .returning({ id: commentThreads.id });

    if (deleted.length === 0) {
      throw new ForbiddenException('Only its author or the app precursor can delete this thread');
    }

    await this.audit.record({
      actorId: userId,
      action: AuditAction.COMMENT_THREAD_DELETED,
      resourceType: 'thread',
      resourceId: threadId,
      workspaceId: await this.workspaceOf(thread.appId),
    });
  }

  /**
   * A quién se puede mencionar aquí (RF-815).
   *
   * Solo miembros del workspace de la app. La consulta no acepta un término de
   * búsqueda libre contra toda la tabla de usuarios: filtrar en el cliente
   * sobre una lista ya acotada no revela a nadie de fuera.
   */
  async mentionable(appId: string): Promise<MentionableUserDto[]> {
    return currentTx()
      .select({
        userId: users.id,
        handle: users.handle,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(apps)
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, apps.workspaceId))
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(apps.id, appId))
      .orderBy(asc(users.handle));
  }

  private async insertComment(
    threadId: string,
    body: string,
    parentId: string | null,
    userId: string,
  ): Promise<{ comment: CommentDto; mencionados: string[] }> {
    const [created] = await currentTx()
      .insert(comments)
      .values({ threadId, body, parentId, authorId: userId })
      .returning({ id: comments.id });

    if (!created) throw new ForbiddenException('You cannot comment here');

    const mencionados = await this.syncMentions(created.id, body, userId);
    return { comment: await this.comment(created.id, userId), mencionados };
  }

  /**
   * Guarda las menciones del texto, quedándose solo con quien pertenece al
   * workspace. Mencionar a alguien de fuera no falla: simplemente no se
   * registra, porque avisar de que ese handle no vale ya diría algo sobre él.
   */
  /** Devuelve a quién se ha mencionado, que es justo la audiencia del aviso. */
  private async syncMentions(commentId: string, body: string, userId: string): Promise<string[]> {
    const tx = currentTx();
    await tx.delete(commentMentions).where(eq(commentMentions.commentId, commentId));

    const handles = extractMentions(body);
    if (handles.length === 0) return [];

    const [thread] = await tx
      .select({ appId: commentThreads.appId })
      .from(comments)
      .innerJoin(commentThreads, eq(commentThreads.id, comments.threadId))
      .where(eq(comments.id, commentId));
    if (!thread) return [];

    const candidates = await this.mentionable(thread.appId);
    const matched = candidates.filter(
      (c) => handles.includes(c.handle.toLowerCase()) && c.userId !== userId,
    );
    if (matched.length === 0) return [];

    await tx
      .insert(commentMentions)
      .values(matched.map((m) => ({ commentId, userId: m.userId })))
      .onConflictDoNothing();

    return matched.map((m) => m.userId);
  }

  private async mentionsFor(commentIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (commentIds.length === 0) return map;

    const rows = await currentTx()
      .select({ commentId: commentMentions.commentId, handle: users.handle })
      .from(commentMentions)
      .innerJoin(users, eq(users.id, commentMentions.userId))
      .where(inArray(commentMentions.commentId, commentIds));

    for (const row of rows) {
      map.set(row.commentId, [...(map.get(row.commentId) ?? []), row.handle]);
    }
    return map;
  }

  private async comment(commentId: string, userId: string): Promise<CommentDto> {
    const [row] = await currentTx()
      .select({
        comment: comments,
        handle: users.handle,
        displayName: users.displayName,
        avatarUrl: users.avatarUrl,
      })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.authorId))
      .where(eq(comments.id, commentId));

    if (!row) throw new NotFoundException('That comment does not exist');
    const mentions = await this.mentionsFor([commentId]);
    return this.toComment(row, userId, mentions);
  }

  private toComment(
    row: {
      comment: typeof comments.$inferSelect;
      handle: string;
      displayName: string;
      avatarUrl: string | null;
    },
    userId: string,
    mentions: Map<string, string[]>,
  ): CommentDto {
    const deleted = row.comment.deletedAt !== null;
    return {
      id: row.comment.id,
      parentId: row.comment.parentId,
      // El texto de un comentario borrado no se envía: la interfaz muestra que
      // ahí hubo algo, no qué decía.
      body: deleted ? '' : row.comment.body,
      authorHandle: row.handle,
      authorDisplayName: row.displayName,
      authorAvatarUrl: row.avatarUrl,
      isMine: row.comment.authorId === userId,
      isDeleted: deleted,
      isEdited: row.comment.editedAt !== null,
      mentions: mentions.get(row.comment.id) ?? [],
      createdAt: row.comment.createdAt.toISOString(),
    };
  }

  /** Quienes han escrito en un hilo concreto, borrados incluidos: siguen ahí. */
  private async participantesDelHilo(threadId: string): Promise<string[]> {
    const filas = await currentTx()
      .selectDistinct({ userId: comments.authorId })
      .from(comments)
      .where(eq(comments.threadId, threadId));
    return filas.map((f) => f.userId);
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

/**
 * Un trozo del comentario, para que el aviso diga algo y no solo «han
 * comentado». Se corta corto: es un recordatorio, no el comentario entero.
 */
function extracto(texto: string): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  return limpio.length > 140 ? `${limpio.slice(0, 139)}…` : limpio;
}
