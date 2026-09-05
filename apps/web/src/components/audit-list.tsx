import type { AuditEntry } from '../lib/api.js';
import { cn } from '../lib/utils.js';

/**
 * Cómo se lee cada acción registrada.
 *
 * En la tabla se guarda un identificador estable —`app.created`— porque es lo
 * que aguanta el paso del tiempo y se puede filtrar. Traducirlo aquí y no
 * guardarlo ya redactado permite cambiar la redacción sin reescribir el pasado.
 */
const ACCIONES: Record<string, string> = {
  'session.started': 'signed in',
  'user.created': 'joined the platform',
  'user.role_changed': 'changed a platform role',
  'user.deactivated': 'deactivated an account',
  'user.reactivated': 'reactivated an account',
  'workspace.renamed': 'renamed the workspace',
  'invitation.created': 'invited someone',
  'invitation.revoked': 'revoked an invitation',
  'member.removed': 'removed a member',
  'member.left': 'left the workspace',
  'app.created': 'created an app',
  'app.updated': 'updated an app',
  'app.access_level_changed': 'changed an app access level',
  'app.archived': 'archived an app',
  'app.unarchived': 'unarchived an app',
  'app.deleted': 'deleted an app',
  'app.precursor_transferred': 'transferred a precursor role',
  'app.precursor_inherited': 'inherited an app',
  'document.version_created': 'saved a new version',
  'document.restored': 'restored an earlier version',
  'comment.thread_created': 'started a comment thread',
  'comment.thread_resolved': 'resolved a thread',
  'comment.thread_reopened': 'reopened a thread',
  'comment.thread_deleted': 'deleted a thread',
  /*
   * IA y agentes. Faltaban las de la v2 desde H9: sin entrada aquí, la fila
   * enseña el identificador crudo —`ai.provider_configured`— y se lee como un
   * error de la página y no como lo que es.
   */
  'ai.egress_accepted': 'accepted sending content to a model provider',
  'ai.toggled': 'turned AI on or off',
  'ai.task_assigned': 'assigned a model to a task',
  'ai.quota_changed': 'changed a token quota',
  'ai.provider_configured': 'configured a model provider',
  'ai.provider_verified': 'verified a provider credential',
  'ai.provider_status_changed': 'enabled or disabled a provider',
  'ai.provider_removed': 'removed a model provider',
  'agent.template_created': 'created an agent template',
  'agent.template_updated': 'edited an agent template',
  'agent.template_deleted': 'deleted an agent template',
  'agent.added': 'added an agent to an app',
  'agent.updated': 'adjusted an agent',
  'agent.removed': 'retired an agent from an app',
};

export function AuditList({ entradas }: { entradas: AuditEntry[] }) {
  if (entradas.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-[var(--color-texto-suave)]">
        Nothing recorded yet.
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {entradas.map((entrada) => (
        <li
          key={entrada.id}
          className={cn(
            'flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-[var(--color-borde)] py-2',
            'text-sm last:border-b-0',
          )}
        >
          <span className="font-medium">@{entrada.actorHandle ?? 'someone'}</span>
          <span>{ACCIONES[entrada.action] ?? entrada.action}</span>
          <span className="ml-auto text-xs text-[var(--color-texto-suave)]">
            {new Date(entrada.createdAt).toLocaleString()}
          </span>
          {/*
            Los detalles son identificadores y valores de enum, nunca contenido
            (RF-706). Se enseñan en crudo a propósito: es un registro, y
            adornarlo haría dudar de si se está viendo lo que pasó o una
            interpretación.
          */}
          {Object.keys(entrada.metadata).length > 0 && (
            <span className="w-full font-mono text-xs text-[var(--color-texto-suave)]">
              {JSON.stringify(entrada.metadata)}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
