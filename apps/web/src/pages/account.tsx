import { ThemeToggle } from '../components/theme-toggle.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card.js';
import type { Session } from '../lib/api.js';

/**
 * Ajustes de la cuenta.
 *
 * De momento solo el tema. El nombre visible, el avatar y el handle vienen de
 * GitHub y no se editan aquí a propósito: son los mismos que la persona ya
 * reconoce como suyos, y mantener una copia editable obligaría a decidir cuál
 * de las dos manda cada vez que cambien allí (RF-208).
 */
export function AccountSettingsPage({ session }: { session: Session }) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Account settings</h1>
        <p className="text-sm text-[var(--color-texto-suave)]">Signed in as @{session.handle}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>
            «System» follows whatever your device is doing, which is usually what you want if it
            switches on its own at dusk.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeToggle />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            Your name, avatar and handle come from GitHub and update on your next sign-in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="flex flex-col gap-2 text-sm">
            <Dato etiqueta="Name" valor={session.displayName} />
            <Dato etiqueta="Handle" valor={`@${session.handle}`} />
            <Dato etiqueta="Email" valor={session.email} />
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-20 shrink-0 text-[var(--color-texto-suave)]">{etiqueta}</dt>
      <dd className="min-w-0 truncate">{valor}</dd>
    </div>
  );
}
