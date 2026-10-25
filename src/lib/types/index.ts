export type ModelId =
  | "llama"
  | "gpt-5-nano"
  | "gemini-2.5-flash-lite"
  | "deepseek-v3.2"
  /** Direct fallback-provider model: routed to Agnes AI, never through CVRON. */
  | "agnes-2.5-flash";

/** Which provider actually answered a generation. */
export type ProviderId = "cvron" | "agnes" | "unknown";

export interface AIModel {
  id: ModelId;
  name: string;
  provider: string;
  description: string;
  capabilities: string[];
  endpoint: string;
  color: string;
  icon: string;
  available: boolean;
  /** True when the model is served by the optional Agnes fallback provider. */
  fallback?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  modelId?: ModelId;
  /** Set when the reply was produced by the fallback provider. */
  via?: ProviderId;
  error?: string;
  imageUrl?: string;
  videoUrl?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  modelId: ModelId;
  messages: ChatMessage[];
  pinned?: boolean;
  favorite?: boolean;
}

export interface GeneratedImage {
  id: string;
  prompt: string;
  imageUrl: string;
  modelId: string;
  createdAt: number;
  aspectRatio?: string;
}

export interface GeneratedVideo {
  id: string;
  prompt: string;
  imageUrl: string;
  videoUrl: string;
  createdAt: number;
}

export interface SavedItem {
  id: string;
  type: "response" | "image" | "video" | "code";
  title: string;
  content: string;
  preview?: string;
  createdAt: number;
  conversationId?: string;
}

export type Theme = "light" | "dark" | "system";

export interface UserSettings {
  theme: Theme;
  defaultModel: ModelId;
  enterToSend: boolean;
  markdownRendering: boolean;
  defaultImageAspect: string;
  defaultImageModel: string;
  defaultVideoModel: string;
  sidebarCollapsed: boolean;
  showContextPanel: boolean;
}
