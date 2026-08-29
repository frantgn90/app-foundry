import { type FormEvent, useState } from 'react';

import {
  type Invitation,
  type Member,
  type Workspace,
  useInvitations,
  useInvite,
  useLeaveWorkspace,
  useMembers,
  useRemoveMember,
  useRevokeInvitation,
} from '../lib/api.js';
import { Avatar } from '../components/ui/avatar.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card.js';
import { Input } from '../components/ui/input.js';

export function WorkspacePage({ workspace }: { workspace: Workspace }) {
  const isOwner = workspace.role === 'OWNER';
  const members = useMembers(workspace.id);
  // Solo el dueño puede consultarlas, así que ni se piden si no lo eres.
  const invitations = useInvitations(workspace.id, isOwner);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{workspace.name}</h1>
          {!isOwner && <Badge>Guest</Badge>}
        </div>
        <p className="text-[var(--color-texto-suave)]">
          {isOwner
            ? 'Your space. Invite people to think through ideas together.'
            : "You were invited here. You can collaborate, but the owner manages who's in."}
        </p>
      </header>

      <MembersCard
        workspaceId={workspace.id}
        members={members.data ?? []}
        loading={members.isPending}
        isOwner={isOwner}
      />

      {isOwner && (
        <InvitationsCard workspaceId={workspace.id} invitations={invitations.data ?? []} />
      )}

      {!isOwner && <LeaveCard workspaceId={workspace.id} name={workspace.name} />}
    </div>
  );
}

function MembersCard({
  workspaceId,
  members,
  loading,
  isOwner,
}: {
  workspaceId: string;
  members: Member[];
  loading: boolean;
  isOwner: boolean;
}) {
  const remove = useRemoveMember(workspaceId);

  return (
    <Card>
      <CardHeader>
        <CardTitle>People</CardTitle>
        <CardDescription>Everyone with access to this workspace.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading && <p className="text-sm text-[var(--color-texto-suave)]">Loading…</p>}
        <ul className="flex flex-col divide-y divide-[var(--color-borde)]">
          {members.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <Avatar src={m.avatarUrl} name={m.displayName} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{m.displayName}</span>
                <span className="block truncate text-xs text-[var(--color-texto-suave)]">
                  @{m.handle}
                </span>
              </span>
              <Badge tone={m.role === 'OWNER' ? 'ok' : 'neutral'}>
                {m.role === 'OWNER' ? 'Owner' : 'Member'}
              </Badge>
              {/* Solo el dueño expulsa, y nunca a sí mismo (RF-307). */}
              {isOwner && m.role !== 'OWNER' && (
                <Button
                  variant="danger"
                  className="px-2 py-1 text-xs"
                  disabled={remove.isPending}
                  onClick={() => {
                    remove.mutate(m.userId);
                  }}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function InvitationsCard({
  workspaceId,
  invitations,
}: {
  workspaceId: string;
  invitations: Invitation[];
}) {
  const [email, setEmail] = useState('');
  const invite = useInvite(workspaceId);
  const revoke = useRevokeInvitation(workspaceId);
  const pending = invitations.filter((i) => i.status === 'PENDING');

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    invite.mutate(email.trim(), {
      onSuccess: () => {
        setEmail('');
      },
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invitations</CardTitle>
        <CardDescription>
          Invite by email. We don&apos;t send the email for you yet — share the link yourself.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={onSubmit} className="flex gap-2">
          <Input
            type="email"
            required
            placeholder="name@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
            aria-label="Email to invite"
          />
          <Button type="submit" disabled={invite.isPending}>
            {invite.isPending ? 'Inviting…' : 'Invite'}
          </Button>
        </form>

        {invite.isError && (
          <p className="text-sm" style={{ color: 'var(--color-fallo)' }}>
            That invitation could not be sent.
          </p>
        )}

        {pending.length === 0 ? (
          <p className="text-sm text-[var(--color-texto-suave)]">
            No invitations waiting. Anyone you invite shows up here until they sign in.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-borde)]">
            {pending.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="min-w-0 flex-1 truncate text-sm">{i.email}</span>
                <Badge>Pending</Badge>
                <Button
                  variant="ghost"
                  className="px-2 py-1 text-xs"
                  disabled={revoke.isPending}
                  onClick={() => {
                    revoke.mutate(i.id);
                  }}
                >
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Marcharse es cosa de quien está invitado; el dueño no puede (RF-310). */
function LeaveCard({ workspaceId, name }: { workspaceId: string; name: string }) {
  const leave = useLeaveWorkspace();
  const [confirming, setConfirming] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Leave this workspace</CardTitle>
        <CardDescription>
          You&apos;ll lose access to {name}. Anything you wrote stays, credited to you.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {confirming ? (
          <div className="flex items-center gap-2">
            <Button
              variant="danger"
              disabled={leave.isPending}
              onClick={() => {
                leave.mutate(workspaceId);
              }}
            >
              Yes, leave
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="secondary"
            onClick={() => {
              setConfirming(true);
            }}
          >
            Leave workspace
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
