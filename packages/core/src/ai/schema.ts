import type { JsonSchema } from './provider.js';

/**
 * El subconjunto de JSON Schema que aceptan los dos proveedores (T-24).
 *
 * La decodificación restringida de Groq garantiza que la respuesta cumple el
 * esquema, pero a cambio exige que **todos** los campos sean obligatorios y que
 * ningún objeto admita propiedades extra. Anthropic no impone eso, así que un
 * esquema escrito para Anthropic puede fallar en Groq y solo se descubriría con
 * una llamada real, en producción y gastando cuota.
 *
 * Escribiendo desde el principio en el subconjunto común, el mismo esquema vale
 * en ambos sin traducción por medio, y esta comprobación lo verifica antes de
 * que salga nada por la red.
 *
 * Lo opcional se expresa como unión con `null` —`{ type: ['string', 'null'] }`—,
 * que es la forma que ambos entienden: el campo sigue estando siempre, y lo que
 * cambia es si trae valor.
 */
export interface SchemaProblem {
  /** Dónde está, en notación de puntos desde la raíz. */
  readonly path: string;
  readonly message: string;
}

export function checkStrictSchema(schema: JsonSchema): SchemaProblem[] {
  const problems: SchemaProblem[] = [];
  visit(schema, '$', problems);
  return problems;
}

export function assertStrictSchema(schema: JsonSchema, name = 'esquema'): void {
  const problems = checkStrictSchema(schema);
  if (problems.length === 0) return;

  const detalle = problems.map((p) => `  ${p.path}: ${p.message}`).join('\n');
  throw new Error(
    `El ${name} no está en el subconjunto estricto que aceptan los dos proveedores (T-24):\n${detalle}`,
  );
}

/** Un campo que puede no traer valor, expresado como lo entienden ambos. */
export function nullable(type: string): JsonSchema {
  return { type: [type, 'null'] };
}

function visit(node: unknown, path: string, problems: SchemaProblem[]): void {
  if (!isObject(node)) {
    problems.push({ path, message: 'se esperaba un esquema y hay otra cosa' });
    return;
  }

  if ('$ref' in node) {
    problems.push({
      path,
      message: 'las referencias no se admiten: escribe el esquema en línea',
    });
    return;
  }

  const branches = node['anyOf'];
  if (Array.isArray(branches)) {
    branches.forEach((branch, index) => {
      visit(branch, `${path}.anyOf[${String(index)}]`, problems);
    });
    return;
  }

  const type = typeOf(node);
  if (type === 'object') visitObject(node, path, problems);
  if (type === 'array') visitArray(node, path, problems);
}

function visitObject(node: Record<string, unknown>, path: string, problems: SchemaProblem[]): void {
  const properties = node['properties'];
  if (!isObject(properties)) {
    problems.push({ path, message: 'un objeto tiene que declarar sus propiedades' });
    return;
  }

  if (node['additionalProperties'] !== false) {
    problems.push({ path, message: 'falta `additionalProperties: false`' });
  }

  const declaradas = Object.keys(properties);
  const required = node['required'];
  const obligatorias = new Set(Array.isArray(required) ? required.map(String) : []);

  /*
   * Lo que de verdad atrapa esta comprobación: un campo declarado y no exigido.
   * En Anthropic funciona y en Groq no, y sin este aviso la diferencia aparece
   * en la primera llamada real.
   */
  const opcionales = declaradas.filter((key) => !obligatorias.has(key));
  if (opcionales.length > 0) {
    problems.push({
      path,
      message: `campos declarados y no exigidos: ${opcionales.join(', ')}. Todo campo es obligatorio; lo que puede faltar se expresa con \`nullable\``,
    });
  }

  const sobrantes = [...obligatorias].filter((key) => !declaradas.includes(key));
  if (sobrantes.length > 0) {
    problems.push({ path, message: `exigidos pero no declarados: ${sobrantes.join(', ')}` });
  }

  for (const [key, value] of Object.entries(properties)) {
    visit(value, `${path}.${key}`, problems);
  }
}

function visitArray(node: Record<string, unknown>, path: string, problems: SchemaProblem[]): void {
  const items = node['items'];
  if (items === undefined) {
    problems.push({ path, message: 'una lista tiene que declarar de qué es' });
    return;
  }
  visit(items, `${path}[]`, problems);
}

function typeOf(node: Record<string, unknown>): string | undefined {
  const type = node['type'];
  if (typeof type === 'string') return type;
  /* Una unión con null: el tipo real es el que no es null. */
  if (Array.isArray(type)) return type.map(String).find((t) => t !== 'null');
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
