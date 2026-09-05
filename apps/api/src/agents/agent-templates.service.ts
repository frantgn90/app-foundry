import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';

import { AGENT_CATALOG, catalogAgent } from '@app-foundry/core';
import { agentTemplates, workspaces } from '@app-foundry/db';

import { AuditAction, AuditService } from '../audit/audit.service.js';
import { currentTx } from '@app-foundry/platform';
import type {
  AdoptAgentTemplateDto,
  AgentTemplateDto,
  CatalogAgentDto,
  CreateAgentTemplateDto,
  UpdateAgentTemplateDto,
} from './agents.dto.js';

type Fila = typeof agentTemplates.$inferSelect;

/**
 * Las plantillas de agente de un workspace (RF-1501, RF-1502).
 *
 * El molde. Quien firma un comentario es siempre una instancia en una app
 * concreta, y esa la crea otro servicio a partir de una de estas.
 *
 * Quién puede qué: las **lee** cualquier miembro y las **escribe** solo el
 * dueño. Que las lea cualquiera no es una concesión, es lo que hace posible
 * RF-1503: sin verlas, quien puede editar una app no podría instanciar ninguna.
 */
@Injectable()
export class AgentTemplatesService {
  constructor(private readonly audit: AuditService) {}

  /** Las del workspace, por handle, sin las archivadas. */
  async list(workspaceId: string): Promise<AgentTemplateDto[]> {
    await this.assertVisible(workspaceId);

    const filas = await currentTx()
      .select()
      .from(agentTemplates)
      .where(and(eq(agentTemplates.workspaceId, workspaceId), isNull(agentTemplates.archivedAt)))
      .orderBy(asc(agentTemplates.handle));

    return filas.map(toDto);
  }

  /**
   * El catálogo de fábrica, tal cual (RF-1513).
   *
   * No consulta la base para nada: son datos del producto y se sirven igual
   * tenga el workspace cien plantillas o ninguna. Pedir ver el catálogo es
   * pedir ver el workspace, y de eso ya se encarga la política del motor.
   */
  async catalog(workspaceId: string): Promise<CatalogAgentDto[]> {
    await this.assertVisible(workspaceId);

    /*
     * Se dice de antemano qué handles chocan y con cuál se adoptaría (RF-1515).
     * Enterarse por un 409 después de elegir es peor: obliga a inventar un
     * nombre en el momento en que uno solo quería empezar a probar.
     */
    const cogidos = new Set(
      (
        await currentTx()
          .select({ handle: agentTemplates.handle })
          .from(agentTemplates)
          .where(eq(agentTemplates.workspaceId, workspaceId))
      ).map((f) => f.handle.toLowerCase()),
    );

    return AGENT_CATALOG.map((perfil) => ({
      ...perfil,
      handleTaken: cogidos.has(perfil.handle.toLowerCase()),
      availableHandle: primeroLibre(perfil.handle, cogidos),
    }));
  }

  /**
   * Adopta un perfil de fábrica: lo **copia** al workspace (RF-1514).
   *
   * Y ahí se corta el vínculo: no se guarda de qué entrada salió. Es la
   * decisión que evita la pregunta «el catálogo cambió, ¿lo adoptas?», que
   * entre dos filas del workspace tiene sentido porque el cambio lo hizo
   * alguien conocido (RF-1505), y aquí sería proponerle al dueño adoptar una
   * decisión nuestra sobre un texto que él ya hizo suyo.
   *
   * Adoptar **es crear una plantilla**, así que lo hace el dueño y nadie más
   * (RF-1502). La consecuencia, que conviene conocer: un workspace recién
   * creado necesita un gesto suyo antes de que ninguna app pueda tener agentes.
   */
  async adopt(
    workspaceId: string,
    key: string,
    body: AdoptAgentTemplateDto,
    userId: string,
  ): Promise<AgentTemplateDto> {
    await this.assertOwner(workspaceId, userId);

    const perfil = catalogAgent(key);
    if (!perfil) throw new NotFoundException('There is no such profile in the catalog');

    /*
     * Si el handle elegido ya está, se dice **y se ofrece uno libre** (RF-1515).
     * Renombrar por nuestra cuenta sería más cómodo y peor: quien adopta un
     * perfil espera encontrarse el handle que vio, no uno parecido que nadie le
     * enseñó. Y sobrescribir la plantilla que había queda descartado de raíz.
     */
    const elegido = body.handle ?? perfil.handle;
    const cogidos = new Set(
      (
        await currentTx()
          .select({ handle: agentTemplates.handle })
          .from(agentTemplates)
          .where(eq(agentTemplates.workspaceId, workspaceId))
      ).map((f) => f.handle.toLowerCase()),
    );
    if (cogidos.has(elegido.toLowerCase())) {
      throw new ConflictException(
        `@${elegido} is already taken here. @${primeroLibre(elegido, cogidos)} is free`,
      );
    }

    return this.create(
      workspaceId,
      {
        name: perfil.name,
        handle: body.handle ?? perfil.handle,
        iconEmoji: perfil.iconEmoji,
        iconColor: perfil.iconColor,
        prompt: perfil.prompt,
      },
      userId,
      { key: perfil.key },
    );
  }

  async create(
    workspaceId: string,
    body: CreateAgentTemplateDto,
    userId: string,
    /* De qué perfil de fábrica salió, solo para la auditoría: la fila no lo guarda. */
    origen?: { key: string },
  ): Promise<AgentTemplateDto> {
    await this.assertOwner(workspaceId, userId);

    const [creada] = await currentTx()
      .insert(agentTemplates)
      .values({
        workspaceId,
        name: body.name.trim(),
        handle: body.handle,
        iconEmoji: body.iconEmoji,
        iconColor: body.iconColor,
        prompt: body.prompt,
        replyWordLimit: body.replyWordLimit ?? 0,
        provider: body.model?.provider ?? null,
        modelId: body.model?.modelId ?? null,
        createdBy: userId,
      })
      .onConflictDoNothing()
      .returning();

    /*
     * Sin fila es que el handle ya estaba: el único de la base es quien lo dice,
     * y no una consulta previa que dejaría una carrera entre mirar y escribir.
     */
    if (!creada) {
      throw new ConflictException(`There is already a template called @${body.handle} here`);
    }

    await this.audit.record({
      actorId: userId,
      action: AuditAction.AGENT_TEMPLATE_CREATED,
      resourceType: 'agent_template',
      resourceId: creada.id,
      workspaceId,
      /* El handle identifica; el prompt no se registra jamás (RF-1703). */
      metadata: { handle: creada.handle, ...(origen && { fromCatalog: origen.key }) },
    });

    return toDto(creada);
  }

  /**
   * Cambia lo que se mande y deja lo demás como estaba.
   *
   * No toca las instancias ya creadas, y eso es deliberado (RF-1505): una
   * instancia lleva el prompt con el que sus comentarios se escribieron, y
   * reescribirla a distancia dejaría un historial en el que el agente dice
   * cosas que su perfil actual no explica.
   */
  async update(
    workspaceId: string,
    templateId: string,
    body: UpdateAgentTemplateDto,
    userId: string,
  ): Promise<AgentTemplateDto> {
    await this.assertOwner(workspaceId, userId);
    const actual = await this.find(workspaceId, templateId);

    const cambios: Partial<typeof agentTemplates.$inferInsert> = { updatedAt: new Date() };
    if (body.name !== undefined) cambios.name = body.name.trim();
    if (body.handle !== undefined) cambios.handle = body.handle;
    if (body.iconEmoji !== undefined) cambios.iconEmoji = body.iconEmoji;
    if (body.iconColor !== undefined) cambios.iconColor = body.iconColor;
    if (body.prompt !== undefined) cambios.prompt = body.prompt;
    if (body.replyWordLimit !== undefined) cambios.replyWordLimit = body.replyWordLimit;
    if (body.model !== undefined) {
      cambios.provider = body.model?.provider ?? null;
      cambios.modelId = body.model?.modelId ?? null;
    }

    let actualizada: Fila | undefined;
    try {
      [actualizada] = await currentTx()
        .update(agentTemplates)
        .set(cambios)
        .where(eq(agentTemplates.id, templateId))
        .returning();
    } catch (error: unknown) {
      /* El único de la base es quien decide si el handle nuevo estaba libre. */
      if (!esHandleRepetido(error)) throw error;
      throw new ConflictException(`There is already a template called @${body.handle} here`);
    }
    if (!actualizada) throw new NotFoundException('That template does not exist');

    await this.audit.record({
      actorId: userId,
      action: AuditAction.AGENT_TEMPLATE_UPDATED,
      resourceType: 'agent_template',
      resourceId: templateId,
      workspaceId,
      /*
       * Qué campos cambiaron, no lo que dicen. De un prompt se registra que
       * cambió; su texto no entra en la auditoría ni una sola vez (RF-1703).
       */
      metadata: {
        handle: actualizada.handle,
        campos: Object.keys(cambios).filter((c) => c !== 'updatedAt'),
        promptChanged: body.prompt !== undefined && body.prompt !== actual.prompt,
      },
    });

    return toDto(actualizada);
  }

  /**
   * Borra la plantilla sin tocar a sus instancias (RF-1505, RF-1509).
   *
   * Los agentes que salieron de ella se quedan donde están y pierden el
   * puntero, que es lo que hace la clave ajena. Lo que un agente escribió sigue
   * siendo suyo aunque el molde ya no exista.
   */
  async remove(workspaceId: string, templateId: string, userId: string): Promise<void> {
    await this.assertOwner(workspaceId, userId);
    const plantilla = await this.find(workspaceId, templateId);

    await currentTx().delete(agentTemplates).where(eq(agentTemplates.id, templateId));

    await this.audit.record({
      actorId: userId,
      action: AuditAction.AGENT_TEMPLATE_DELETED,
      resourceType: 'agent_template',
      resourceId: templateId,
      workspaceId,
      metadata: { handle: plantilla.handle },
    });
  }

  private async find(workspaceId: string, templateId: string): Promise<Fila> {
    const [fila] = await currentTx()
      .select()
      .from(agentTemplates)
      .where(and(eq(agentTemplates.id, templateId), eq(agentTemplates.workspaceId, workspaceId)));

    if (!fila) throw new NotFoundException('That template does not exist');
    return fila;
  }

  /**
   * La comprobación explícita, además de la política del motor.
   *
   * La RLS ya impediría escribir, pero devolviendo cero filas, que se lee como
   * «no existe» y no como «no es tuyo». Aquí el rechazo se nombra (RNF-102).
   */
  private async assertOwner(workspaceId: string, userId: string): Promise<void> {
    const [fila] = await currentTx()
      .select({ ownerId: workspaces.ownerId })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));

    if (!fila) throw new NotFoundException('That workspace does not exist');
    if (fila.ownerId !== userId) {
      throw new ForbiddenException('Only the workspace owner manages agent templates');
    }
  }

  /**
   * Que el workspace se vea basta para listar.
   *
   * No hace falta preguntar por la pertenencia: la política de `workspaces`
   * solo deja ver los propios, así que si la fila aparece es que se es miembro,
   * y si no aparece el 404 dice lo justo —que ahí no hay nada para quien
   * pregunta— sin confirmar que exista (RNF-102).
   */
  private async assertVisible(workspaceId: string): Promise<void> {
    const [fila] = await currentTx()
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));

    if (!fila) throw new NotFoundException('That workspace does not exist');
  }
}

function toDto(fila: Fila): AgentTemplateDto {
  return {
    id: fila.id,
    name: fila.name,
    handle: fila.handle,
    iconEmoji: fila.iconEmoji,
    iconColor: fila.iconColor,
    prompt: fila.prompt,
    replyWordLimit: fila.replyWordLimit,
    model:
      fila.provider && fila.modelId ? { provider: fila.provider, modelId: fila.modelId } : null,
    createdAt: fila.createdAt.toISOString(),
    updatedAt: fila.updatedAt.toISOString(),
  };
}

/** `23505` es violación de unicidad: aquí solo puede ser el handle. */
function esHandleRepetido(error: unknown): boolean {
  let actual: unknown = error;
  while (actual instanceof Error) {
    if ((actual as Error & { code?: string }).code === '23505') return true;
    actual = actual.cause;
  }
  return false;
}

/**
 * El primer handle libre a partir del sugerido: `po`, `po-2`, `po-3`…
 *
 * Sufijo numérico y no un nombre distinto porque quien adopta un segundo
 * «product owner» quiere justamente eso, y `po-2` se lee al vuelo. El tope de
 * cien es para que no haya bucle: con esa cifra el problema ya no es el nombre.
 */
function primeroLibre(sugerido: string, cogidos: ReadonlySet<string>): string {
  if (!cogidos.has(sugerido.toLowerCase())) return sugerido;

  for (let n = 2; n <= 100; n += 1) {
    const candidato = `${sugerido}-${n}`;
    if (!cogidos.has(candidato.toLowerCase())) return candidato;
  }
  return sugerido;
}
