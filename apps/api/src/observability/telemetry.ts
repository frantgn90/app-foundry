/**
 * Inicialización de OpenTelemetry.
 *
 * Este módulo se carga con `node --import` **antes** que la aplicación: las
 * instrumentaciones funcionan enganchándose a la carga de los módulos que
 * instrumentan, así que si Nest, pg o ioredis se cargaran primero, no habría
 * nada que enganchar y la telemetría saldría vacía sin dar ningún error.
 */
import { register } from 'node:module';

import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

// Necesario para que las instrumentaciones alcancen a los módulos ESM: sin este
// hook solo se instrumentaría lo que se cargue por require().
register('@opentelemetry/instrumentation/hook.mjs', import.meta.url);

const enabled = process.env['OTEL_ENABLED'] !== 'false';
const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318';
const serviceName = process.env['OTEL_SERVICE_NAME'] ?? 'app-foundry-api';

if (enabled) {
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: '0.0.0',
    }),
    traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      exportIntervalMillis: 15_000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Ruido puro: cada lectura de fichero como span no ayuda a nadie.
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          // Las comprobaciones de salud llegan cada pocos segundos y ahogarían
          // las trazas que sí interesan. Se pueden trazar poniendo
          // OTEL_TRACE_HEALTH=true, que es cómodo para depurar la propia
          // cadena de observabilidad.
          ignoreIncomingRequestHook: (request) =>
            process.env['OTEL_TRACE_HEALTH'] !== 'true' &&
            (request.url ?? '').startsWith('/health'),
        },
      }),
    ],
  });

  sdk.start();

  const apagar = (): void => {
    void sdk.shutdown().finally(() => process.exit(0));
  };
  process.once('SIGTERM', apagar);
  process.once('SIGINT', apagar);
}
