import { type FormEvent, useState } from 'react';

import {
  type AccessLevel,
  type App,
  useChangeAccessLevel,
  useDeleteApp,
  useMembers,
  useSetArchived,
  useTransferPrecursor,
  useUpdateApp,
} from '../lib/api.js';
import { type Icon, IconPicker } from '../components/icon-picker.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { AppAgents } from '../components/app-agents.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card.js';
import { Input } from '../components/ui/input.js';

const STATUSES = ['IDEA', 'DEFINING', 'IN_DEVELOPMENT', 'PUBLISHED', 'PAUSED'] as const;

/** Qué significa cada nivel, dicho como lo entiende una persona (RF-407). */
const ACCESS_LEVELS: { value: AccessLevel; label: string; help: string }[] = [
  { value: 'PRIVATE', label: 'Only me', help: 'Nobody else in this workspace can see it.' },
  {
    value: 'WORKSPACE_READ',
    label: 'Workspace can read',
    help: 'Everyone here can read and comment, but only you can edit.',
  },
  {
    value: 'WORKSPACE_WRITE',
    label: 'Workspace can edit',
    help: 'Everyone here can edit it. Every change is kept in the history.',
  },
];

export function AppSettingsPage({
  app,
  workspaceId,
  onDeleted,
}: {
  app: App;
  workspaceId: string;
  onDeleted: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <DetailsCard app={app} />
      <AppAgents appId={app.id} workspaceId={workspaceId} puedeEditar={app.canEdit} />
      {/* Estas decisiones son del precursor y de nadie más (RF-406, RF-409..411). */}
      {app.isPrecursor && <AccessCard app={app} workspaceId={workspaceId} />}
      {app.isPrecursor && <DangerCard app={app} onDeleted={onDeleted} />}
      {!app.isPrecursor && (
        <p className="text-sm text-[var(--color-texto-suave)]">
          @{app.precursorHandle} started this app, so sharing and deleting are theirs to decide.
        </p>
      )}
    </div>
  );
}

function DetailsCard({ app }: { app: App }) {
  const update = useUpdateApp(app.id);
  const [name, setName] = useState(app.name);
  const [description, setDescription] = useState(app.shortDescription ?? '');
  const [status, setStatus] = useState(app.status);
  const [tags, setTags] = useState(app.tags.join(', '));
  const [repoUrl, setRepoUrl] = useState(app.repoUrl ?? '');
  const [icon, setIcon] = useState<Icon>({
    emoji: app.icon.emoji as Icon['emoji'],
    color: app.icon.color as Icon['color'],
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    update.mutate({
      name,
      shortDescription: description,
      status: status as (typeof STATUSES)[number],
      // Se aceptan separadas por comas: es como la gente escribe una lista.
      tags: tags
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 8),
      ...(repoUrl ? { repoUrl } : {}),
      iconEmoji: icon.emoji,
      iconColor: icon.color,
    });
  }

  const disabled = !app.canEdit;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
        <CardDescription>
          {disabled
            ? app.isArchived
              ? 'This app is archived, so it is read-only.'
              : 'You can read this app but not edit it.'
            : 'Everything here can change as the idea takes shape.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              disabled={disabled}
              required
            />
          </Field>

          <Field label="One line about it">
            <Input
              value={description}
              placeholder="Track what you read and why"
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              disabled={disabled}
            />
          </Field>

          <Field label="Status">
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
              }}
              disabled={disabled}
              className="w-full rounded-lg border border-[var(--color-borde)] bg-[var(--color-fondo)] px-3 py-2 text-sm"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ').toLowerCase()}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Tags" hint="Comma separated, up to eight">
            <Input
              value={tags}
              placeholder="reading, personal"
              onChange={(e) => {
                setTags(e.target.value);
              }}
              disabled={disabled}
            />
          </Field>

          <Field label="Repository" hint="Just a link for now — nothing is synced yet">
            <Input
              type="url"
              value={repoUrl}
              placeholder="https://github.com/you/your-repo"
              onChange={(e) => {
                setRepoUrl(e.target.value);
              }}
              disabled={disabled}
            />
          </Field>

          {!disabled && (
            <Field label="Icon">
              <IconPicker emoji={icon.emoji} color={icon.color} onChange={setIcon} />
            </Field>
          )}

          {!disabled && (
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? 'Saving…' : 'Save changes'}
              </Button>
              {update.isSuccess && (
                <span className="text-xs" style={{ color: 'var(--color-ok)' }}>
                  Saved
                </span>
              )}
              {update.isError && (
                <span className="text-xs" style={{ color: 'var(--color-fallo)' }}>
                  {update.error.message}
                </span>
              )}
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function AccessCard({ app, workspaceId }: { app: App; workspaceId: string }) {
  const change = useChangeAccessLevel(app.id);
  const members = useMembers(workspaceId);
  const others = Math.max((members.data?.length ?? 1) - 1, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who can see this</CardTitle>
        <CardDescription>
          {others === 0
            ? 'Nobody else is in this workspace yet, so sharing changes nothing for now.'
            : `${String(others)} other ${others === 1 ? 'person is' : 'people are'} in this workspace.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {ACCESS_LEVELS.map((level) => (
          <label
            key={level.value}
            className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--color-borde)] p-3"
          >
            <input
              type="radio"
              name="access"
              className="mt-1"
              checked={app.accessLevel === level.value}
              onChange={() => {
                change.mutate(level.value);
              }}
              disabled={change.isPending}
            />
            <span>
              <span className="block text-sm font-medium">{level.label}</span>
              <span className="block text-xs text-[var(--color-texto-suave)]">{level.help}</span>
            </span>
          </label>
        ))}
        {change.isError && (
          <p className="text-xs" style={{ color: 'var(--color-fallo)' }}>
            {change.error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function DangerCard({ app, onDeleted }: { app: App; onDeleted: () => void }) {
  const archive = useSetArchived(app.id);
  const remove = useDeleteApp(app.id);
  const transfer = useTransferPrecursor(app.id);
  const [confirmName, setConfirmName] = useState('');

  return (
    <Card className="border-[var(--color-fallo)]/30">
      <CardHeader>
        <CardTitle>Archive or delete</CardTitle>
        <CardDescription>
          Archiving is reversible and keeps everything. Deleting is not.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            disabled={archive.isPending}
            onClick={() => {
              archive.mutate(!app.isArchived);
            }}
          >
            {app.isArchived ? 'Unarchive' : 'Archive'}
          </Button>
          {app.isArchived && <Badge tone="warning">archived</Badge>}
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Delete this app</span>
          <p className="text-xs text-[var(--color-texto-suave)]">
            Its vision and every version of it go with it. Type <strong>{app.name}</strong> to
            confirm.
          </p>
          <div className="flex gap-2">
            <Input
              value={confirmName}
              placeholder={app.name}
              onChange={(e) => {
                setConfirmName(e.target.value);
              }}
              aria-label="Type the app name to confirm"
            />
            <Button
              variant="danger"
              // Escribir el nombre es la única barrera contra un clic
              // distraído sobre algo irrecuperable (RF-411).
              disabled={confirmName !== app.name || remove.isPending}
              onClick={() => {
                remove.mutate(undefined, { onSuccess: onDeleted });
              }}
            >
              Delete
            </Button>
          </div>
        </div>

        {transfer.isError && (
          <p className="text-xs" style={{ color: 'var(--color-fallo)' }}>
            {transfer.error.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-[var(--color-texto-suave)]">{hint}</span>}
    </label>
  );
}
