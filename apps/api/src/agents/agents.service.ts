import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, count, desc, eq, isNull } from 'drizzle-orm';

import type { Env } from '@app-foundry/env';
import {
  agentPromptRevisions,
  agents,
  agentTemplates,
  apps,
  users,
  workspaceMembers,
} from '@app-foundry/db';

import { AuditAction, AuditService } from '../audit/audit.service.js';
import { currentTx } from '@app-foundry/ai-runtime';
import { ENV } from '../infrastructure/tokens.js';
import type { AddAgentDto, AgentDto, UpdateAgentDto } from './agents.dto.js';

type FilaAgente = typeof agents.$inferSelect;

/** Lo que hace falta saber de una app para decidir si se puede tocar. */
interface AppParaEditar {
  id: string;
  workspaceId: string;
  precursorId: string;
  accessLevel: string;
  archivedAt: Date | null;
}

/**
 * Los agentes de una app: las instancias que firman (RF-1503).
 *
 * Se instancian desde una plantilla del workspace y a partir de ahí viven su
 * vida: el prompt se ajusta aquí sin tocar el molde (RF-1504) y editar el molde
 * no vuelve (RF-1505).
 *
 * Quién puede qué: los **ve** quien ve la app y los **toca** quien puede
 * editarla, incluido un invitado con permiso de escritura. Es la misma regla
 * que gobierna documentos y versiones, y por el mismo motivo: quien puede
 * escribir en la app es un colaborador de pleno derecho.
 */
@Injectable()
export class AgentsService {
  constructor(
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Los que siguen en la app, por handle. Los retirados no se listan.
   *
   * Cada uno resuelve aparte su prompt vigente y su plantilla, en vez de con un
   * join: el vigente es la revisión de número más alto, y un join sin más
   * traería todas. Son a lo sumo cinco agentes por app (RF-1507), así que la
   * consulta extra por fila no es un problema que haya que resolver hoy.
   */
  async list(appId: string): Promise<AgentDto[]> {
    await this.appVisible(appId);

    const filas = await currentTx()
      .select()
      .from(agents)
      .where(and(eq(agents.appId, appId), isNull(agents.removedAt)))
      .orderBy(asc(agents.handle));

    /*
     * En serie y no con `Promise.all`: todas estas consultas comparten la
     * conexión de la transacción, y lanzarlas a la vez las encabalga en el
     * mismo cliente de `pg`. Funciona por accidente y avisa de que va a dejar
     * de hacerlo; con cinco agentes por app tampoco había nada que ganar.
     */
    const dtos: AgentDto[] = [];
    for (const fila of filas) dtos.push(await this.toDto(fila));
    return dtos;
  }

  /**
   * Instancia una plantilla del workspace en esta app (RF-1503).
   *
   * Copia nombre, handle, icono, modelo y prompt, y guarda ese prompt como
   * revisión 1. A partir de ahí son cosas distintas.
   */
  async add(appId: string, body: AddAgentDto, userId: string): Promise<AgentDto> {
    const app = await this.appEditable(appId, userId);
    await this.assertCabeUnoMas(appId);

    const [plantilla] = await currentTx()
      .select()
      .from(agentTemplates)
      .where(
        and(
          eq(agentTemplates.id, body.templateId),
          eq(agentTemplates.workspaceId, app.workspaceId),
        ),
      );
    if (!plantilla) throw new NotFoundException('That template does not exist');

    const handle = body.handle ?? plantilla.handle;
    await this.assertHandleLibre(app, appId, handle);

    const [creado] = await currentTx()
      .insert(agents)
      .values({
        appId,
        templateId: plantilla.id,
        name: body.name?.trim() ?? plantilla.name,
        handle,
        iconEmoji: plantilla.iconEmoji,
        iconColor: plantilla.iconColor,
        provider: plantilla.provider,
        modelId: plantilla.modelId,
        addedBy: userId,
      })
      .onConflictDoNothing()
      .returning();
    if (!creado) throw new ConflictException(`There is already an agent called @${handle} here`);

    await currentTx()
      .insert(agentPromptRevisions)
      .values({
        agentId: creado.id,
        revision: 1,
        prompt: body.prompt ?? plantilla.prompt,
        createdBy: userId,
      });

    await this.audit.record({
      actorId: userId,
      action: AuditAction.AGENT_ADDED,
      resourceType: 'agent',
      resourceId: creado.id,
      workspaceId: app.workspaceId,
      metadata: { appId, handle: creado.handle, templateId: plantilla.id },
    });

    return this.toDto(creado);
  }

  /**
   * Ajusta la instancia sin tocar la plantilla (RF-1504).
   *
   * Cambiar el prompt **añade una revisión**, nunca reescribe la que hay: los
   * comentarios ya escritos apuntan a la suya, y editarla a posteriori diría
   * que el agente habló con un perfil que entonces no tenía (RF-1510).
   */
  async update(
    appId: string,
    agentId: string,
    body: UpdateAgentDto,
    userId: string,
  ): Promise<AgentDto> {
    const app = await this.appEditable(appId, userId);
    /* Que exista y siga en esta app; el resto se lee de lo que devuelve el UPDATE. */
    await this.find(appId, agentId);

    const cambios: Partial<typeof agents.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) cambios.name = body.name.trim();
    if (body.handle !== undefined) {
      await this.assertHandleLibre(app, appId, body.handle, agentId);
      cambios.handle = body.handle;
    }
    if (body.active !== undefined) cambios.active = body.active;
    if (body.model !== undefined) {
      cambios.provider = body.model?.provider ?? null;
      cambios.modelId = body.model?.modelId ?? null;
    }

    const [actualizado] = await currentTx()
      .update(agents)
      .set(cambios)
      .where(eq(agents.id, agentId))
      .returning();
    if (!actualizado) throw new NotFoundException('That agent does not exist');

    if (body.prompt !== undefined && body.prompt !== (await this.promptVigente(agentId)).prompt) {
      await this.nuevaRevision(agentId, body.prompt, userId);
    }

    await this.audit.record({
      actorId: userId,
      action: AuditAction.AGENT_UPDATED,
      resourceType: 'agent',
      resourceId: agentId,
      workspaceId: app.workspaceId,
      /* Qué cambió, no lo que dice: el prompt no entra en la auditoría (RF-1703). */
      metadata: {
        appId,
        handle: actualizado.handle,
        campos: Object.keys(cambios).filter((c) => c !== 'updatedAt'),
        promptChanged: body.prompt !== undefined,
        ...(body.active !== undefined && { active: body.active }),
      },
    });

    return this.toDto(actualizado);
  }

  /**
   * Trae el prompt actual de su plantilla, como revisión nueva (RF-1505).
   *
   * No se propaga solo: editar una plantilla no toca sus instancias, porque
   * cada una lleva el prompt con el que sus comentarios se escribieron. Que la
   * plantilla cambió se **avisa**, y adoptarlo es una decisión de quien edita
   * esta app, no del dueño del workspace.
   *
   * Y se adopta añadiendo revisión, como cualquier otro ajuste: el prompt de
   * antes sigue legible, que es de donde cuelga lo que el agente ya dijo.
   */
  async adoptTemplate(appId: string, agentId: string, userId: string): Promise<AgentDto> {
    const app = await this.appEditable(appId, userId);
    const agente = await this.find(appId, agentId);

    if (!agente.templateId) {
      throw new ConflictException('This agent no longer descends from a template');
    }

    const [plantilla] = await currentTx()
      .select({ prompt: agentTemplates.prompt })
      .from(agentTemplates)
      .where(eq(agentTemplates.id, agente.templateId));
    if (!plantilla) throw new NotFoundException('That template does not exist');

    const vigente = await this.promptVigente(agentId);
    if (plantilla.prompt === vigente.prompt) {
      throw new ConflictException('This agent already matches its template');
    }

    await this.nuevaRevision(agentId, plantilla.prompt, userId);

    await this.audit.record({
      actorId: userId,
      action: AuditAction.AGENT_UPDATED,
      resourceType: 'agent',
      resourceId: agentId,
      workspaceId: app.workspaceId,
      metadata: { appId, handle: agente.handle, adoptedTemplate: true, promptChanged: true },
    });

    return this.toDto(agente);
  }

  /**
   * Retira al agente de la app, sin borrar lo que escribió (RF-1509).
   *
   * Fecha y bandera a la vez, que es lo que exige el motor: un retirado
   * «activo» seguiría contestando en una app de la que ya se le sacó.
   */
  async remove(appId: string, agentId: string, userId: string): Promise<void> {
    const app = await this.appEditable(appId, userId);
    const agente = await this.find(appId, agentId);

    await currentTx()
      .update(agents)
      .set({ removedAt: new Date(), active: false, updatedAt: new Date() })
      .where(eq(agents.id, agentId));

    await this.audit.record({
      actorId: userId,
      action: AuditAction.AGENT_REMOVED,
      resourceType: 'agent',
      resourceId: agentId,
      workspaceId: app.workspaceId,
      metadata: { appId, handle: agente.handle },
    });
  }

  private async find(appId: string, agentId: string): Promise<FilaAgente> {
    const [fila] = await currentTx()
      .select()
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.appId, appId), isNull(agents.removedAt)));

    if (!fila) throw new NotFoundException('That agent does not exist');
    return fila;
  }

  /** El prompt vigente: la revisión de número más alto (RF-1510). */
  private async promptVigente(agentId: string): Promise<{ prompt: string; revision: number }> {
    const [fila] = await currentTx()
      .select({ prompt: agentPromptRevisions.prompt, revision: agentPromptRevisions.revision })
      .from(agentPromptRevisions)
      .where(eq(agentPromptRevisions.agentId, agentId))
      .orderBy(desc(agentPromptRevisions.revision))
      .limit(1);

    if (!fila) throw new NotFoundException('That agent has no prompt');
    return fila;
  }

  private async nuevaRevision(agentId: string, prompt: string, userId: string): Promise<void> {
    const vigente = await this.promptVigente(agentId);
    await currentTx()
      .insert(agentPromptRevisions)
      .values({
        agentId,
        revision: vigente.revision + 1,
        prompt,
        createdBy: userId,
      });
  }

  /**
   * El tope de agentes por app (RF-1507, RNF-1002).
   *
   * Existe porque una revisión los invoca a todos de un gesto: sin tope, añadir
   * agentes es gratis y pedir una revisión, carísimo. Cuenta los que siguen en
   * la app; los retirados no ocupan sitio.
   */
  private async assertCabeUnoMas(appId: string): Promise<void> {
    const [fila] = await currentTx()
      .select({ cuantos: count() })
      .from(agents)
      .where(and(eq(agents.appId, appId), isNull(agents.removedAt)));

    const tope = this.env.AI_MAX_AGENTS_PER_APP;
    if ((fila?.cuantos ?? 0) >= tope) {
      throw new ConflictException(
        `This app already has ${tope} agents, which is the limit. Remove one before adding another`,
      );
    }
  }

  /**
   * Que el handle no lo tenga ya nadie **en esta app**, ni agente ni persona.
   *
   * Lo primero lo garantiza el único parcial de la base; se comprueba aquí
   * además para poder decirlo con un mensaje en vez de con un error del motor.
   *
   * Lo segundo no lo garantiza nadie y hace falta: un agente se llama
   * escribiendo `@algo`, igual que una persona, así que si un miembro del
   * workspace ya usa ese handle la mención sería ambigua —a quién se avisa y a
   * quién se invoca— y las dos respuestas serían defendibles. Se cierra la
   * puerta al crear, que es el único momento en que se puede hacer sin quitarle
   * el nombre a nadie.
   */
  private async assertHandleLibre(
    app: AppParaEditar,
    appId: string,
    handle: string,
    excepto?: string,
  ): Promise<void> {
    const [persona] = await currentTx()
      .select({ handle: users.handle })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.workspaceId, app.workspaceId), eq(users.handle, handle)));
    if (persona) {
      throw new ConflictException(
        `@${handle} is a person in this workspace. Pick another handle for the agent`,
      );
    }

    const existentes = await currentTx()
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.appId, appId), eq(agents.handle, handle), isNull(agents.removedAt)));

    if (existentes.some((a) => a.id !== excepto)) {
      throw new ConflictException(`There is already an agent called @${handle} here`);
    }
  }

  private async appVisible(appId: string): Promise<AppParaEditar> {
    const [app] = await currentTx()
      .select({
        id: apps.id,
        workspaceId: apps.workspaceId,
        precursorId: apps.precursorId,
        accessLevel: apps.accessLevel,
        archivedAt: apps.archivedAt,
      })
      .from(apps)
      .where(eq(apps.id, appId));

    if (!app) throw new NotFoundException('That app does not exist');
    return app;
  }

  /**
   * Poder editar la app, dicho con nombre.
   *
   * La RLS ya lo impediría, pero devolviendo cero filas, que se lee como «no
   * existe» y no como «no puedes» (RNF-102).
   */
  private async appEditable(appId: string, userId: string): Promise<AppParaEditar> {
    const app = await this.appVisible(appId);

    if (app.archivedAt !== null) {
      throw new ForbiddenException('This app is archived');
    }
    if (app.precursorId !== userId && app.accessLevel !== 'WORKSPACE_WRITE') {
      throw new ForbiddenException('You cannot edit this app');
    }
    return app;
  }

  private async toDto(fila: FilaAgente): Promise<AgentDto> {
    const vigente = await this.promptVigente(fila.id);

    const [plantilla] = fila.templateId
      ? await currentTx()
          .select({
            id: agentTemplates.id,
            name: agentTemplates.name,
            prompt: agentTemplates.prompt,
          })
          .from(agentTemplates)
          .where(eq(agentTemplates.id, fila.templateId))
      : [];

    return {
      id: fila.id,
      name: fila.name,
      handle: fila.handle,
      iconEmoji: fila.iconEmoji,
      iconColor: fila.iconColor,
      prompt: vigente.prompt,
      promptRevision: vigente.revision,
      active: fila.active,
      model:
        fila.provider && fila.modelId ? { provider: fila.provider, modelId: fila.modelId } : null,
      template: plantilla
        ? { id: plantilla.id, name: plantilla.name, drifted: plantilla.prompt !== vigente.prompt }
        : null,
      createdAt: fila.createdAt.toISOString(),
    };
  }
}
