export interface BGAWidgetConfig {
  apiUrl: string;
  projectId: string;
  token?: string;
  theme?: "light" | "dark";
  position?: "bottom-right" | "bottom-left";
  title?: string;
  placeholder?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  metadata?: {
    intent?: string;
    citations?: Citation[];
    hallucinationPassed?: boolean;
  };
}

export interface Citation {
  type: "document" | "graph";
  source: string;
  score?: number;
}

export interface ChatResponse {
  content?: string;
  answer?: string;
  intent?: string;
  intent_confidence?: number;
  retrieval_strategy?: string;
  citations?: Citation[];
  hallucination_score?: number;
  hallucination_passed?: boolean;
  metadata?: {
    intent?: string;
    citations?: Citation[];
    hallucinationScore?: number;
    hallucinationPassed?: boolean;
    retrievalStrategy?: string;
  };
}
