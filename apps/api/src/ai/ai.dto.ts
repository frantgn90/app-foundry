import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  ValidateNested,
  IsInt,
  IsOptional,
  IsPositive,
  Max,
  Min,
  IsString,
  Length,
} from 'class-validator';

import {
  AiProvider,
  AiTask,
  ASSIST_ACTIONS,
  type AssistAction,
  AssistScope,
  type Monetisation,
  MONETISATIONS,
} from '@app-foundry/core';

const PROVEEDORES = Object.values(AiProvider);
const TAREAS = Object.values(AiTask);
const ALCANCES = Object.values(AssistScope);

export class ProviderCapabilitiesDto {
  @ApiProperty() streaming!: boolean;
  @ApiProperty({ description: 'Garantiza que la respuesta cumple un esquema declarado' })
  schemaOutput!: boolean;
  @ApiProperty({ description: 'Busca en la web desde su propia infraestructura' })
  webSearch!: boolean;
  @ApiProperty({ description: 'Cuenta los tokens por API en vez de obligar a aproximar' })
  exactTokenCount!: boolean;
}

/**
 * Un proveedor configurado, tal como lo ve quien pregunta.
 *
 * Los campos de dueño van marcados como opcionales porque **no se envían** a
 * quien no lo es (RF-1002). No es un detalle de presentación: el cupo y el
 * momento de la última verificación son asuntos de quien paga.
 */
export class AiProviderDto {
  @ApiProperty({ enum: PROVEEDORES })
  provider!: AiProvider;

  @ApiProperty({ enum: ['ACTIVE', 'DISABLED', 'INVALID'] })
  status!: 'ACTIVE' | 'DISABLED' | 'INVALID';

  @ApiProperty({ type: ProviderCapabilitiesDto })
  capabilities!: ProviderCapabilitiesDto;

  @ApiPropertyOptional({
    description: 'Últimos caracteres de la clave, para reconocerla. Solo para el dueño',
  })
  credentialHint?: string;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Cupo mensual de tokens. Solo para el dueño',
  })
  monthlyTokenQuota?: number | null;

  @ApiPropertyOptional({ description: 'Porcentaje del cupo al que se avisa. Solo para el dueño' })
  quotaAlertPct?: number;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Solo para el dueño' })
  verifiedAt?: string | null;
}

export class ConfigureProviderDto {
  @ApiProperty({
    description: 'La clave del proveedor. Se cifra al guardarla y no vuelve a salir de aquí',
    minLength: 8,
    maxLength: 400,
  })
  @IsString()
  @Length(8, 400)
  apiKey!: string;
}

export class SetProviderStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'DISABLED'] })
  @IsIn(['ACTIVE', 'DISABLED'])
  status!: 'ACTIVE' | 'DISABLED';
}

/**
 * Si en este workspace se ha aceptado que el contenido salga a un tercero
 * (RF-1011).
 *
 * Es un hecho del workspace, no de cada proveedor: lo que se consiente es que
 * el texto de las apps deje de estar solo aquí.
 */
export class AiEgressConsentDto {
  @ApiProperty()
  accepted!: boolean;

  @ApiProperty({ type: String, nullable: true })
  acceptedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Handle de quien lo aceptó' })
  acceptedBy!: string | null;
}

/** Los ajustes de IA del workspace, lo que no es de un proveedor concreto. */
export class AiSettingsDto {
  @ApiProperty({ description: 'Interruptor general (RF-1012)' })
  enabled!: boolean;

  @ApiProperty({ type: AiEgressConsentDto })
  consent!: AiEgressConsentDto;
}

export class SetAiEnabledDto {
  @ApiProperty({ description: 'Apagar o encender toda la IA del workspace' })
  @IsBoolean()
  enabled!: boolean;
}

/** Un modelo del catálogo del proveedor (RF-1007). Sin precio: no lo publica nadie. */
export class AiModelDto {
  @ApiProperty({ enum: PROVEEDORES })
  provider!: AiProvider;

  @ApiProperty()
  id!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ description: 'Cero significa que el proveedor no lo declara' })
  contextWindow!: number;

  @ApiProperty({ description: 'Cero significa que el proveedor no lo declara' })
  maxOutputTokens!: number;

  @ApiProperty({ description: 'Si el proveedor lo sigue ofreciendo' })
  available!: boolean;
}

/**
 * Qué modelo atiende una tarea, y con qué merma si la tiene.
 *
 * `supported` y `degraded` salen de comparar lo que la tarea exige con lo que el
 * proveedor declara (RF-1008): es lo que permite dibujar la interfaz desde las
 * capacidades y no desde una lista de proveedores conocidos.
 */
export class AiTaskAssignmentDto {
  @ApiProperty({ enum: TAREAS })
  task!: AiTask;

  @ApiProperty({ enum: PROVEEDORES, nullable: true })
  provider!: AiProvider | null;

  @ApiProperty({ type: String, nullable: true })
  modelId!: string | null;

  @ApiProperty({ description: 'Si con lo asignado la tarea se puede ofrecer' })
  supported!: boolean;

  @ApiProperty({ description: 'Si el modelo asignado sigue en el catálogo del proveedor' })
  modelAvailable!: boolean;

  @ApiProperty({ type: [String], description: 'Capacidades que faltan y lo impiden' })
  missing!: string[];

  @ApiProperty({ type: [String], description: 'Capacidades que faltan y solo la empobrecen' })
  degraded!: string[];
}

export class AssignTaskModelDto {
  @ApiProperty({ enum: PROVEEDORES })
  @IsIn(PROVEEDORES as readonly string[])
  provider!: AiProvider;

  @ApiProperty()
  @IsString()
  @Length(1, 200)
  modelId!: string;
}

export class SetQuotaDto {
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Cupo mensual de tokens. Nulo o ausente lo deja sin techo',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  monthlyTokenQuota?: number | null;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, description: 'A qué porcentaje se avisa' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  quotaAlertPct?: number;
}

/** Una línea del desglose de consumo. */
export class AiUsageBreakdownDto {
  @ApiProperty({ description: 'Tarea, modelo, proveedor o handle, según el desglose' })
  key!: string;

  @ApiProperty() inputTokens!: number;
  @ApiProperty() outputTokens!: number;
  @ApiProperty() invocations!: number;
}

/** Lo consumido de un proveedor este mes, frente a su cupo. */
export class AiProviderUsageDto {
  @ApiProperty({ enum: PROVEEDORES })
  provider!: AiProvider;

  @ApiProperty({ type: Number, nullable: true, description: 'Cupo mensual, o nulo si no tiene' })
  quota!: number | null;

  @ApiProperty({ description: 'Tokens ya consumidos según el contador' })
  spentTokens!: number;

  @ApiProperty({ description: 'Tokens apartados por invocaciones en curso' })
  reservedTokens!: number;
}

/**
 * El consumo del mes (RF-1208).
 *
 * Cada uno ve lo suyo y el dueño ve todo lo de su workspace, y eso no lo decide
 * este DTO sino la política de la tabla: aquí no hay ningún filtro por usuario.
 */
export class AiUsageDto {
  @ApiProperty({ description: 'Mes en curso, contado en UTC' })
  month!: string;

  @ApiProperty({ type: [AiProviderUsageDto], description: 'Solo para el dueño' })
  providers!: AiProviderUsageDto[];

  @ApiProperty({ type: [AiUsageBreakdownDto] }) byTask!: AiUsageBreakdownDto[];
  @ApiProperty({ type: [AiUsageBreakdownDto] }) byModel!: AiUsageBreakdownDto[];
  @ApiProperty({ type: [AiUsageBreakdownDto] }) byMember!: AiUsageBreakdownDto[];
}

/**
 * Qué funciones de IA se pueden ofrecer ahora mismo (RF-1010).
 *
 * Existe aparte de la asignación de tareas porque responde a otra pregunta y la
 * hace otra gente: la asignación es del dueño y dice **qué modelo** atiende cada
 * cosa; esto lo consulta cualquier miembro y dice si merece la pena enseñar el
 * botón. Un botón que lleva a un error no es una funcionalidad, es una trampa.
 */
export class AiTaskAvailabilityDto {
  @ApiProperty({ enum: TAREAS })
  task!: AiTask;

  @ApiProperty()
  available!: boolean;
}

export class AiAvailabilityDto {
  @ApiProperty({ description: 'El interruptor general del workspace' })
  enabled!: boolean;

  @ApiProperty({ type: [AiTaskAvailabilityDto] })
  tasks!: AiTaskAvailabilityDto[];
}

/**
 * Lo que se le pide al asistente de escritura (RF-1401, RF-1411).
 *
 * `start` y `end` son posiciones en el **fuente** de la copia de trabajo, las
 * mismas que ancla un comentario, y solo valen con alcance de selección.
 *
 * `revision` es lo que hace que esas posiciones signifiquen algo: si el
 * documento ha cambiado desde que el cliente lo leyó, apuntan a otro texto. Es
 * la misma protección que la de un guardado concurrente (RF-511, RF-1408).
 */
export class AssistDto {
  @ApiProperty({ enum: ASSIST_ACTIONS })
  @IsIn(ASSIST_ACTIONS)
  action!: AssistAction;

  @ApiProperty({ enum: ALCANCES })
  @IsIn(ALCANCES)
  scope!: AssistScope;

  @ApiPropertyOptional({ type: Number, description: 'Inicio de la selección en el fuente' })
  @IsOptional()
  @IsInt()
  @Min(0)
  start?: number;

  @ApiPropertyOptional({ type: Number, description: 'Fin de la selección en el fuente' })
  @IsOptional()
  @IsInt()
  @Min(0)
  end?: number;

  @ApiProperty({ description: 'La revisión de la copia de trabajo que se está mirando' })
  @IsInt()
  @Min(0)
  revision!: number;
}

/**
 * El techo de una acción del asistente, antes de pedirla (RF-1412).
 *
 * «Como mucho N tokens», no «unos N»: es entrada contada más salida al máximo.
 * Una media que luego se pasa sería peor que no enseñar nada.
 */
export class AssistEstimateDto {
  @ApiProperty({ enum: PROVEEDORES })
  provider!: AiProvider;

  @ApiProperty()
  modelId!: string;

  @ApiProperty({ description: 'Qué contexto cabe: el documento entero o solo el entorno' })
  variant!: string;

  @ApiProperty({ description: 'Verdadero cuando el documento no cabe y va solo el entorno' })
  contextTrimmed!: boolean;

  @ApiProperty()
  maxOutputTokens!: number;

  @ApiProperty({ description: 'Techo: entrada contada más salida al máximo' })
  estimatedTokens!: number;
}

/**
 * Lo que acota una tanda de ideas (RF-1302).
 *
 * **Todo opcional, y eso es el requisito.** Quien llega sin saber qué construir
 * tampoco sabe para quién ni con qué modelo de negocio: un campo obligatorio le
 * pediría justo lo que ha venido a buscar.
 */
export class GenerateIdeasDto {
  @ApiPropertyOptional({ description: 'Tema o dominio' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  topic?: string;

  @ApiPropertyOptional({ description: 'Tiempo disponible, en palabras: «un fin de semana»' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  timeAvailable?: string;

  @ApiPropertyOptional({ enum: MONETISATIONS })
  @IsOptional()
  @IsIn(MONETISATIONS)
  monetisation?: Monetisation;

  @ApiPropertyOptional({ description: 'Público objetivo' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  audience?: string;

  @ApiPropertyOptional({ description: 'Plataforma' })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  platform?: string;

  @ApiPropertyOptional({ description: 'Notas libres' })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  notes?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Nombres ya propuestos, para que la siguiente tanda no los repita',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  exclude?: string[];
}

/** Una fuente citada por la búsqueda, que se conserva en la visión sembrada. */
export class IdeaSourceDto {
  @ApiProperty()
  @IsString()
  @Length(1, 500)
  url!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 300)
  title!: string;
}

/**
 * La propuesta elegida, tal cual la vio quien la eligió (RF-1308).
 *
 * Viaja de vuelta entera porque las propuestas **no se guardan**: si nadie
 * elige, no queda rastro más allá del registro de la invocación (RF-1312).
 * Guardarlas «por si acaso» dejaría en la base de datos cuatro ideas
 * descartadas por cada una elegida, y ninguna de ellas es de nadie.
 */
export class ChooseIdeaDto {
  @ApiProperty()
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 2000)
  problem!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 1000)
  audience!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 2000)
  valueProposition!: string;

  @ApiProperty({ enum: MONETISATIONS })
  @IsIn(MONETISATIONS)
  monetisation!: Monetisation;

  @ApiProperty()
  @IsString()
  @Length(1, 200)
  effort!: string;

  @ApiProperty()
  @IsString()
  @Length(1, 1000)
  mainRisk!: string;

  @ApiProperty({ type: [String], maxItems: 8 })
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  tags!: string[];

  @ApiProperty()
  @IsString()
  @Length(1, 300)
  shortDescription!: string;

  @ApiPropertyOptional({ type: [IdeaSourceDto], maxItems: 20 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => IdeaSourceDto)
  sources?: IdeaSourceDto[];
}
