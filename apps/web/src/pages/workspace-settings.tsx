import { type FormEvent, useState } from 'react';

import {
  type AppColor,
  APP_COLORS,
  type WorkspaceBackground,
  WORKSPACE_BACKGROUNDS,
  type WorkspaceEmoji,
  WORKSPACE_EMOJIS,
} from '@app-foundry/core';

import { BACKGROUNDS, backgroundStyle } from '../components/workspace-background.js';
import { ICON_BACKGROUNDS } from '../components/icon-picker.js';
import { Button } from '../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card.js';
import { Input } from '../components/ui/input.js';
import { type Workspace, useUpdateWorkspace } from '../lib/api.js';
import { cn } from '../lib/utils.js';

export function WorkspaceSettingsPage({ workspace }: { workspace: Workspace }) {
  const update = useUpdateWorkspace(workspace.id);
  const isOwner = workspace.role === 'OWNER';

  const [name, setName] = useState(workspace.name);
  // El contrato acepta solo los valores del catálogo, así que el estado los
  // conoce desde el principio en vez de convertirlos al guardar.
  const [emoji, setEmoji] = useState(workspace.iconEmoji as WorkspaceEmoji);
  const [color, setColor] = useState(workspace.iconColor as AppColor);
  const [background, setBackground] = useState(workspace.background as WorkspaceBackground);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    update.mutate({ name, iconEmoji: emoji, iconColor: color, background });
  }

  if (!isOwner) {
    return (
      <Card className="p-6">
        <p className="text-sm text-[var(--color-texto-suave)]">
          You&apos;re a guest here. Only the owner can change how this workspace looks.
        </p>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      {/* La vista previa manda: se decide mirando, no leyendo nombres de colores. */}
      <Card className={cn('overflow-hidden border-0', backgroundStyle(background))}>
        <div className="flex items-center gap-3 p-6">
          <span
            className={cn(
              'grid size-11 place-items-center rounded-xl text-xl',
              ICON_BACKGROUNDS[color] ?? ICON_BACKGROUNDS['slate'],
            )}
            aria-hidden
          >
            {emoji}
          </span>
          <span className="text-lg font-semibold tracking-tight">{name || 'Untitled'}</span>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Name</CardTitle>
          <CardDescription>How this workspace appears in your switcher.</CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            value={name}
            required
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Icon</CardTitle>
          <CardDescription>
            A workspace is recognised by its colour before its name, especially when you belong to
            several.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1">
            {WORKSPACE_EMOJIS.map((option) => (
              <button
                key={option}
                type="button"
                aria-label={`Icon ${option}`}
                aria-pressed={option === emoji}
                onClick={() => {
                  setEmoji(option);
                }}
                className={cn(
                  'grid size-9 place-items-center rounded-md text-lg transition',
                  'hover:bg-[var(--color-borde)]/60',
                  option === emoji && 'bg-[var(--color-borde)] ring-2 ring-[var(--color-acento)]',
                )}
              >
                {option}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {APP_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                aria-label={`Colour ${option}`}
                aria-pressed={option === color}
                onClick={() => {
                  setColor(option);
                }}
                className={cn(
                  'grid size-9 place-items-center rounded-md transition',
                  ICON_BACKGROUNDS[option],
                  option === color && 'ring-2 ring-[var(--color-acento)]',
                )}
              >
                <span className="text-base" aria-hidden>
                  {emoji}
                </span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Background</CardTitle>
          <CardDescription>
            Shown behind the workspace header. They&apos;re all deliberately quiet — what you need
            to read are the app names, not the decoration.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {WORKSPACE_BACKGROUNDS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={option === background}
                onClick={() => {
                  setBackground(option);
                }}
                className={cn(
                  'flex flex-col gap-1.5 rounded-lg border p-1.5 text-left transition',
                  option === background
                    ? 'border-[var(--color-acento)]'
                    : 'border-[var(--color-borde)] hover:border-[var(--color-acento)]/40',
                )}
              >
                <span
                  className={cn(
                    'h-12 rounded-md border border-[var(--color-borde)]',
                    BACKGROUNDS[option].style,
                  )}
                  aria-hidden
                />
                <span className="px-1 text-xs">{BACKGROUNDS[option].label}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

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
    </form>
  );
}

export type { WorkspaceBackground };
