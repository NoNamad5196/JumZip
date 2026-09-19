import type { FullSajuResult } from '../domain/full-saju.ts';

export type CharacterId = 'BOMI' | 'SANI' | 'ARANG';
// Additive timing metadata is optional for immutable readings saved before M9.
export type SajuCurrentFlow = Pick<FullSajuResult, 'daewoon' | 'sewoon' | 'monthlyFortune' | 'timing'>;
export type SpreadType = 'ONE_CARD' | 'GENERAL_3' | 'RELATIONSHIP_3' | 'DECISION_3';
export type Orientation = 'UPRIGHT' | 'REVERSED';
export type TarotCard = { cardId: number; orientation: Orientation; positionIndex: number; positionKey: string };
export type Card = TarotCard;
export type ExecutionStatus = 'PENDING' | 'PARTIAL' | 'SUCCEEDED' | 'FAILED';
export type ApiError = { code: string; message: string; retryable: boolean; details?: Record<string, unknown> };
export type Envelope<T> = { ok: true; data: T; meta: { requestId: string; schemaVersion: 1; createdAt: string } } | { ok: false; error: ApiError; meta: { requestId: string; schemaVersion: 1; createdAt: string } };
export type ChatResult = { executionStatus: 'SUCCEEDED'; conversationId: string; consultationId: string | null; userMessage: { id: string; createdAt: string }; assistantMessage: { id: string; characterId: CharacterId; content: string; segments: string[] }; recommendation?: unknown };
export type TarotResult = { executionStatus: 'PARTIAL' | 'SUCCEEDED'; conversationId: string; consultationId: string; drawGroupId: string; spreadType: SpreadType; mode: 'NORMAL' | 'DAILY'; cards: TarotCard[]; interpretation: { messageId: string; content: string; segments: string[] } | null; partialError?: ApiError };
export const SCHEMA_VERSION = 1 as const;
export const CHARACTERS = ['BOMI', 'SANI', 'ARANG'] as const;
export const SPREADS = ['ONE_CARD', 'GENERAL_3', 'RELATIONSHIP_3', 'DECISION_3'] as const;
