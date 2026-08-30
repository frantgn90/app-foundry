import { ThemeToggle } from '../components/theme-toggle.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card.js';
import { useState } from 'react';

import { Button } from '../components/ui/button.js';
import { type Session, useDeactivateAccount } from '../lib/api.js';

/**
 * Ajustes de la cuenta.
 *
 * El tema y la baja. El nombre visible, el avatar y el handle vienen de
 * GitHub y no se editan aquí a propósito: son los mismos que la persona ya
 * reconoce como suyos, y mantener una copia editable obligaría a decidir cuál
 * de las dos manda cada vez que cambien allí (RF-208).
 */
export function AccountSettingsPage({ session, onBack }: { session: Session; onBack: () => void }) {
  const [confirmando, setConfirmando] = useState(false);
  const baja = useDeactivateAccount();

  return (
    <div className="flex flex-col gap-6">
      {/*
        Los ajustes son un desvío del trabajo, así que hace falta la puerta de
        vuelta: sin ella solo se sale eligiendo un workspace del desplegable, que
        es una forma rara de decir «he terminado aquí». Mismo gesto que en la
        ficha de una app.
      */}
      <button
        onClick={onBack}
        className="self-start text-sm text-[var(--color-texto-suave)] hover:underline"
      >
        ← Back
      </button>

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

      {/*
        La baja va al final y en su propia tarjeta: es lo único de esta página
        que tiene consecuencias, y no debe quedar a un dedo de distancia de
        cambiar el tema.
      */}
      <Card>
        <CardHeader>
          <CardTitle>Close your account</CardTitle>
          <CardDescription>
            Nothing is deleted. Your account is switched off and your apps enter a 90-day grace
            period: they stop being visible to anyone, and if you sign in again within that time
            they come back exactly as you left them. Apps you started in someone else&apos;s
            workspace stay there, under its owner.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {baja.isError && (
            <p className="mb-3 text-sm" style={{ color: 'var(--color-fallo)' }}>
              That didn&apos;t work. Nothing has changed.
            </p>
          )}

          {confirmando ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="danger"
                disabled={baja.isPending}
                onClick={() => {
                  baja.mutate();
                }}
              >
                {baja.isPending ? 'Closing…' : 'Yes, close my account'}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setConfirmando(false);
                }}
              >
                Cancel
              </Button>
              <span className="text-xs text-[var(--color-texto-suave)]">
                You&apos;ll be signed out straight away.
              </span>
            </div>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                setConfirmando(true);
              }}
            >
              Close my account
            </Button>
          )}
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
