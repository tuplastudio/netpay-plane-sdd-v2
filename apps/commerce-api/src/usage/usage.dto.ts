import { IsDecimal, IsInt, IsString, Min, MinLength } from "class-validator";

/** Reporta un consumo de tokens del agente. Interno: solo lo llama agent-v2
 * con su propia API key de servicio; el tenant sale de esa key. */
export class RecordUsageEventDto {
  @IsString()
  @MinLength(1)
  model!: string;

  @IsInt()
  @Min(0)
  inputTokens!: number;

  @IsInt()
  @Min(0)
  outputTokens!: number;

  @IsString()
  @IsDecimal({ decimal_digits: "0,6" })
  costUsd!: string;
}
