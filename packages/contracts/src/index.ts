import { z } from "zod";

export const localeSchema = z.string().regex(/^[a-z]{2}-[A-Z]{2}$/);
export const liveUserSchema = z.object({ platformUserId: z.string().min(1), username: z.string(), displayName: z.string() });
const base = { id: z.string().min(1), sessionId: z.string().min(1), occurredAt: z.string().datetime(), user: liveUserSchema, raw: z.unknown().optional() };
export const commentEventSchema = z.object({ ...base, type: z.literal("COMMENT"), text: z.string().max(1000) });
export const giftProgressEventSchema = z.object({ ...base, type: z.literal("GIFT_PROGRESS"), giftId: z.string(), giftName: z.string(), quantity: z.number().int().positive(), coins: z.number().nonnegative().optional() });
export const giftCompletedEventSchema = z.object({ ...base, type: z.literal("GIFT_COMPLETED"), giftId: z.string(), giftName: z.string(), quantity: z.number().int().positive(), coins: z.number().nonnegative().optional(), raw: z.unknown().optional() });
export const followEventSchema = z.object({ ...base, type: z.literal("FOLLOW") });
export const joinEventSchema = z.object({ ...base, type: z.literal("JOIN") });
export const likeEventSchema = z.object({ ...base, type: z.literal("LIKE"), quantity: z.number().int().positive().default(1) });
export const roomStatsEventSchema = z.object({ id: z.string(), sessionId: z.string().min(1), occurredAt: z.string().datetime(), type: z.literal("ROOM_STATS"), viewerCount: z.number().int().nonnegative(), raw: z.unknown().optional() });
export const connectedEventSchema = z.object({ id: z.string(), sessionId: z.string(), occurredAt: z.string().datetime(), type: z.literal("CONNECTED"), raw: z.unknown().optional() });
export const disconnectedEventSchema = connectedEventSchema.extend({ type: z.literal("DISCONNECTED") });
export const liveEventSchema = z.discriminatedUnion("type", [commentEventSchema, giftProgressEventSchema, giftCompletedEventSchema, followEventSchema, joinEventSchema, likeEventSchema, roomStatsEventSchema, connectedEventSchema, disconnectedEventSchema]);
export type LiveEvent = z.infer<typeof liveEventSchema>;
export type LiveUser = z.infer<typeof liveUserSchema>;

export const readingOutputSchema = z.object({ safe: z.literal(true), category: z.string(), opening: z.string(), cards: z.array(z.object({ cardId: z.string(), interpretation: z.string() })), summary: z.string(), closing: z.string(), spokenText: z.string(), safetyFlags: z.array(z.string()) });
export type ReadingOutput = z.infer<typeof readingOutputSchema>;
export const interactionOutputSchema = z.object({ safe:z.literal(true), spokenText:z.string().min(8).max(320), tone:z.enum(["warm","curious","reflective","grateful"]) });
export type InteractionOutput = z.infer<typeof interactionOutputSchema>;
export const moderationResultSchema = z.discriminatedUnion("action", [z.object({ action: z.literal("ALLOW") }), z.object({ action: z.literal("REFRAME"), safeQuestion: z.string() }), z.object({ action: z.literal("REQUEST_NEW_QUESTION"), reasonCode: z.string() }), z.object({ action: z.literal("MANUAL_REVIEW"), reasonCode: z.string() })]);
export type ModerationResult = z.infer<typeof moderationResultSchema>;

export const playbackTimelineSchema = z.object({ commandId: z.string(), requestId: z.string(), viewer: z.object({ displayName: z.string() }), question: z.string().optional(), audioUrl: z.string(), durationMs: z.number().int().positive(), cards: z.array(z.object({ id: z.string(), orientation: z.enum(["upright", "reversed"]) })), cues: z.array(z.object({ atMs: z.number().int().nonnegative(), type: z.enum(["SHOW_VIEWER", "SHUFFLE", "DEAL", "REVEAL_CARD", "AVATAR_STATE", "RESET"]), payload: z.unknown().optional() })) });
export type PlaybackTimeline = z.infer<typeof playbackTimelineSchema>;

export const rendererMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("READY"), sequence: z.number().int().nonnegative() }),
  z.object({ type: z.literal("STARTED"), commandId: z.string() }),
  z.object({ type: z.literal("PROGRESS"), commandId: z.string(), atMs: z.number().int().nonnegative() }),
  z.object({ type: z.literal("COMPLETED"), commandId: z.string() }),
  z.object({ type: z.literal("ERROR"), commandId: z.string().optional(), error: z.string() }),
  z.object({ type: z.literal("HEARTBEAT"), commandId: z.string().optional() }),
  z.object({ type: z.literal("INTERACTION_COMPLETED") }),
  z.object({ type: z.literal("INTERACTION_ERROR"), error: z.string() })
]);
export type RendererMessage = z.infer<typeof rendererMessageSchema>;
