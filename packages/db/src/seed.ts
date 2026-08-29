/**
 * Datos de ejemplo para desarrollo (RNF-303).
 *
 * Crea dos personas y un workspace compartido con apps en los tres niveles de
 * acceso, que es lo que hace falta para **ver funcionando** el modelo de
 * permisos en lugar de solo leerlo.
 *
 * Si hay un usuario real —el administrador configurado en el entorno—, se le
 * invita al workspace de ejemplo para que pueda mirarlo desde su propia sesión.
 * Sin eso, el escenario existiría en la base de datos y nadie podría verlo.
 */
import { and, eq, sql } from 'drizzle-orm';

import { createDb, type Database } from './client.js';
import {
  apps,
  appTags,
  documents,
  documentVersions,
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from './schema/index.js';

const VISION_ANA = `# The problem

I read a lot and remember little. Notes end up scattered across three apps and a
notebook I never open again.

# Who it's for

People who read to learn, not to finish books.

# The value proposition

One place where what you read turns into something you can actually use later.
`;

const VISION_COMPARTIDA = `# The problem

Deciding what to build next is guesswork. Ideas live in heads, chats and
half-written documents.

# Who it's for

Small teams who ship things and want to remember why.
`;

interface Persona {
  handle: string;
  displayName: string;
  githubId: number;
}

const ANA: Persona = { handle: 'ana-ejemplo', displayName: 'Ana', githubId: 900001 };
const BRUNO: Persona = { handle: 'bruno-ejemplo', displayName: 'Bruno', githubId: 900002 };

async function ensureUser(db: Database, persona: Persona): Promise<string> {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.githubId, persona.githubId));
  if (existing) return existing.id;

  const [created] = await db
    .insert(users)
    .values({
      githubId: persona.githubId,
      handle: persona.handle,
      email: `${persona.handle}@example.com`,
      displayName: persona.displayName,
    })
    .returning({ id: users.id });
  return created!.id;
}

async function ensureWorkspace(db: Database, ownerId: string, slug: string, name: string) {
  const [existing] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.slug, slug));
  if (existing) return existing.id;

  const [created] = await db
    .insert(workspaces)
    .values({ ownerId, name, slug })
    .returning({ id: workspaces.id });
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: created!.id, userId: ownerId, role: 'OWNER' });
  return created!.id;
}

async function createApp(
  db: Database,
  input: {
    workspaceId: string;
    precursorId: string;
    slug: string;
    name: string;
    description: string;
    accessLevel: 'PRIVATE' | 'WORKSPACE_READ' | 'WORKSPACE_WRITE';
    status: 'IDEA' | 'DEFINING' | 'IN_DEVELOPMENT' | 'PUBLISHED' | 'PAUSED';
    tags?: string[];
    emoji: string;
    color: string;
    vision: string;
  },
): Promise<void> {
  // El slug es único **por workspace**, así que comprobarlo globalmente daría
  // por existente una app de otro espacio que solo comparte nombre. Es lo que
  // pasó la primera vez: la app privada del ejemplo no llegó a crearse porque
  // había otra homónima en un workspace distinto.
  const [existing] = await db
    .select({ id: apps.id })
    .from(apps)
    .where(and(eq(apps.workspaceId, input.workspaceId), eq(apps.slug, input.slug)));
  if (existing) return;

  const [app] = await db
    .insert(apps)
    .values({
      workspaceId: input.workspaceId,
      precursorId: input.precursorId,
      slug: input.slug,
      name: input.name,
      shortDescription: input.description,
      accessLevel: input.accessLevel,
      status: input.status,
      iconEmoji: input.emoji,
      iconColor: input.color,
    })
    .returning({ id: apps.id });

  const [document] = await db
    .insert(documents)
    .values({ appId: app!.id, type: 'VISION', currentContent: input.vision })
    .returning({ id: documents.id });

  const [version] = await db
    .insert(documentVersions)
    .values({
      documentId: document!.id,
      versionNo: 1,
      content: input.vision,
      authorId: input.precursorId,
      message: 'Initial version',
    })
    .returning({ id: documentVersions.id });

  await db
    .update(documents)
    .set({ currentVersionId: version!.id })
    .where(eq(documents.id, document!.id));

  if (input.tags?.length) {
    await db.insert(appTags).values(input.tags.map((tag) => ({ appId: app!.id, tag })));
  }
}

export async function seed(connectionString: string): Promise<void> {
  const { db, close } = createDb(connectionString, 2);
  try {
    const anaId = await ensureUser(db, ANA);
    const brunoId = await ensureUser(db, BRUNO);

    const wsAna = await ensureWorkspace(db, anaId, ANA.handle, 'Ana · ejemplo');
    await ensureWorkspace(db, brunoId, BRUNO.handle, 'Bruno · ejemplo');

    // Bruno colabora en el espacio de Ana: es lo que hace visible el modelo.
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: wsAna, userId: brunoId, role: 'MEMBER' })
      .onConflictDoNothing();

    await createApp(db, {
      workspaceId: wsAna,
      precursorId: anaId,
      slug: 'reading-companion',
      name: 'Reading Companion',
      description: 'Turn what you read into something usable',
      accessLevel: 'PRIVATE',
      status: 'DEFINING',
      emoji: '📚',
      color: 'teal',
      tags: ['reading', 'personal'],
      vision: VISION_ANA,
    });

    await createApp(db, {
      workspaceId: wsAna,
      precursorId: anaId,
      slug: 'idea-board',
      name: 'Idea Board',
      description: 'Where the team decides what to build next',
      accessLevel: 'WORKSPACE_WRITE',
      status: 'IN_DEVELOPMENT',
      emoji: '💡',
      color: 'amber',
      tags: ['team', 'planning'],
      vision: VISION_COMPARTIDA,
    });

    await createApp(db, {
      workspaceId: wsAna,
      precursorId: brunoId,
      slug: 'de-bruno',
      name: 'Release Notes',
      description: 'Created by a guest, so it is shared by construction',
      accessLevel: 'WORKSPACE_READ',
      status: 'PAUSED',
      emoji: '📣',
      color: 'rose',
      tags: ['docs'],
      vision: '# The problem\n\nNobody reads release notes because nobody writes them.\n',
    });

    // Al usuario real se le invita, para que pueda ver el escenario desde su
    // propia sesión en lugar de tener que creerse que existe.
    const realHandle = process.env['BOOTSTRAP_ADMIN_GITHUB_LOGIN'];
    if (realHandle) {
      const [real] = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(sql`${users.handle} = ${realHandle}`);
      if (real) {
        await db
          .insert(workspaceMembers)
          .values({ workspaceId: wsAna, userId: real.id, role: 'MEMBER' })
          .onConflictDoNothing();
        await db
          .insert(workspaceInvitations)
          .values({
            workspaceId: wsAna,
            email: 'pendiente@example.com',
            invitedBy: anaId,
            expiresAt: new Date(Date.now() + 14 * 86_400_000),
          })
          .onConflictDoNothing();
        console.log(`  ${realHandle} ha sido invitado al workspace de ejemplo`);
      }
    }

    console.log('Datos de ejemplo listos: 2 personas, 2 workspaces y 3 apps.');
  } finally {
    await close();
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env['DATABASE_MIGRATION_URL'];
  if (!url) {
    console.error('Falta DATABASE_MIGRATION_URL.');
    process.exit(1);
  }
  seed(url)
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error('El seed ha fallado:', error);
      process.exit(1);
    });
}
