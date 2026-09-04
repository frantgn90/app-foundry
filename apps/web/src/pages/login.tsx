import { useEffect, useState } from 'react';

import { Button } from '../components/ui/button.js';
import { Logo } from '../components/logo.js';
import { ForgeFire } from '../components/forge-fire.js';
import { cn } from '../lib/utils.js';

/** Único proveedor de identidad de la plataforma (D-22). */
function GitHubIcon() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export function LoginPage() {
  /*
   * Entrar se va a GitHub, y entre el clic y la primera pantalla de allí pasan
   * segundos en los que la pantalla se queda igual que estaba: sin señal, lo
   * natural es pensar que el botón no ha llegado a pulsarse y volver a pulsarlo.
   */
  const [entrando, setEntrando] = useState(false);

  /*
   * Volver atrás desde GitHub devuelve esta misma página tal cual la dejamos
   * —el navegador la tenía guardada, no la vuelve a construir—, y con ella un
   * barrido eterno sobre un botón que ya no está haciendo nada.
   */
  useEffect(() => {
    const alVolver = (evento: PageTransitionEvent) => {
      if (evento.persisted) setEntrando(false);
    };
    window.addEventListener('pageshow', alVolver);
    return () => {
      window.removeEventListener('pageshow', alVolver);
    };
  }, []);

  return (
    <main className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center gap-8 px-6 py-16">
      <ForgeFire />
      <header className="flex flex-col gap-3">
        <h1 className="flex items-center gap-2.5 text-3xl font-semibold tracking-tight">
          <Logo className="size-8 shrink-0" />
          App Foundry
        </h1>
        <p className="text-[var(--color-texto-suave)]">
          A place to think through, define and track app ideas. Sign in and you get your own
          workspace, empty and waiting.
        </p>
      </header>

      <Button
        // Enlace normal y no fetch: el flujo OAuth es una navegación de verdad,
        // con redirecciones a GitHub y de vuelta.
        onClick={() => {
          // Pulsar dos veces no adelanta nada: la primera navegación ya está en
          // marcha, y la segunda solo la reiniciaría.
          if (entrando) return;
          setEntrando(true);
          window.location.href = '/api/v1/auth/github';
        }}
        /*
         * Ocupado, pero no deshabilitado: apagar el botón lo aleja justo cuando
         * se acaba de pulsar, y el barrido ya dice que está en curso.
         */
        aria-busy={entrando}
        className="w-full py-2.5"
      >
        {/* El icono se queda entero: el recorte del barrido lo dejaría en blanco,
            porque se dibuja con el color del texto. */}
        <GitHubIcon />
        <span className={cn(entrando && 'pensando pensando-sobre-acento')}>
          Continue with GitHub
        </span>
      </Button>

      <p className="text-xs text-[var(--color-texto-suave)]">
        We only ask for your public profile and verified email. No repository access.
      </p>
    </main>
  );
}
