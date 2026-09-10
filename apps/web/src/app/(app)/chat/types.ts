/**
 * Tipos del hilo de chat con el agente comercial.
 *
 * Se extrajeron de `page.tsx` sin tocarlos: la forma del payload que se manda y
 * la que se recibe son exactamente las mismas de antes.
 */

export interface Candidate {
  variantId: string;
  score: number;
  reasons: string[];
  matchType: string;
  conflicts: string[];
  variant?: {
    id: string;
    sku: string;
    title: string;
    productTitle?: string;
    price: string;
    stock: number | null;
  };
}

export interface CartLine {
  variantId: string;
  sku: string;
  title: string;
  quantity: string;
  unitPrice: string | null;
}

export interface AgentResponse {
  conversationId: string;
  reply: string;
  handoff: boolean;
  intent: string | null;
  candidates: Candidate[];
  suggestions: string[];
  totals: Record<string, unknown> | null;
  quote: { quoteId: string; total: string; linkRef: string } | null;
  checkout: { orderId: string; linkRef: string } | null;
  cart: CartLine[];
  knowledgeRefs: string[];
  toolCalls: Array<{ tool: string; ok: boolean; latencyMs: number }>;
  engine: string;
  node: string;
  latencyMs: number;
  transcript?: string | null;
}

/**
 * El agente no devuelve estado de entrega por mensaje, así que el hilo lo lleva
 * en local con los valores del enum `MessageStatus`: PENDING mientras la
 * petición está en vuelo, DELIVERED cuando el agente contestó y FAILED si la
 * petición reventó. Sirve para que un mensaje que no salió no se vea igual que
 * uno que sí.
 */
export type LocalMessageStatus = "PENDING" | "DELIVERED" | "FAILED";

export interface ChatMessage {
  id: string;
  /** `user` se pinta como OUTBOUND (saliente) y `assistant` como INBOUND. */
  role: "user" | "assistant";
  content: string;
  /** Epoch ms del momento en que el mensaje entró al hilo (solo presentación). */
  createdAt: number;
  status?: LocalMessageStatus;
  meta?: {
    candidates?: Candidate[];
    suggestions?: string[];
    knowledgeRefs?: string[];
    quote?: AgentResponse["quote"];
    checkout?: AgentResponse["checkout"];
    engine?: string;
    latencyMs?: number;
    tools?: AgentResponse["toolCalls"];
  };
}

export interface AgentHealth {
  status: string;
  /** Forma mínima v2: `{live, model}`. El v1 también traía `toolCalling`. */
  llm: { live: boolean; model: string; toolCalling?: boolean };
  /** Configurado puede no venir si el agente no expone el catálogo. */
  commerce?: { configured: boolean };
  /** El negocio se anuncia en el header del chat; si el agente no lo trae,
   * el chat usa el placeholder "el negocio". */
  knowledge?: { docs?: number; chunks?: number; business?: string };
}
