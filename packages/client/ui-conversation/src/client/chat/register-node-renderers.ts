import type { Context } from '@deepseek-ai/cordis'
import { NS } from '../locales.ts'
import { AssistantNodeView } from './AssistantNodeView.tsx'
import { CommandNodeView, ManualCompactionNodeView } from './CommandNodeView.tsx'
import {
  CompactionNodeView, ContextMessageNodeView, RetryNodeView, TurnErrorNodeView,
  TurnMaxTokensNodeView, UnknownNodeView, UserMessageNodeView,
} from './MessageItem.tsx'
import { TurnTailNodeView } from './TurnTailNodeView.tsx'

/**
 * Register this package's business renderers behind the keyed Chat Node seat.
 * @param ctx - owning UI Conversation context.
 */
export function registerChatNodeRenderers(ctx: Context): void {
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'user', locale: NS }, UserMessageNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'steering', locale: NS }, UserMessageNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'context', locale: NS }, ContextMessageNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'assistant-step', locale: NS }, AssistantNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'command',
    locale: NS,
    children: { 'conversation.chat.commandview': { kind: 'keyed', scope: 'session' } },
  }, CommandNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'manual-compaction', locale: NS }, ManualCompactionNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'compaction', locale: NS }, CompactionNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'model-retry', locale: NS }, RetryNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'turn-error', locale: NS }, TurnErrorNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'turn-max-tokens', locale: NS }, TurnMaxTokensNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'turn-tail',
    locale: NS,
    children: {
      'conversation.chat.turnTail': { kind: 'chain', scope: 'session' },
      'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' },
    },
  }, TurnTailNodeView))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'unknown', locale: NS }, UnknownNodeView))
}

/** Quiet stand-in for kinds whose main renderer needs session-scoped child
 * seats the embed cannot serve (the standard kit there follows the CURRENT
 * session); the embed seat renders nothing instead of the JsonBlock fallback. */
function EmbedQuietNode(): null { return null }

/**
 * Register the same business renderers behind the embed mirror seat (the
 * Activity panel's child flow). The turn-data Hook arrives through the seat's
 * declaration inject instead of the standard kit.
 * @param ctx - owning UI Conversation context.
 */
export function registerEmbedNodeRenderers(ctx: Context): void {
  ctx.slots.inject('deepcreator.conversation.embed.node', () => ctx.slots.register(
    { name: 'deepcreator.conversation.embed.node', key: 'user', locale: NS }, UserMessageNodeView))
  ctx.slots.inject('deepcreator.conversation.embed.node', () => ctx.slots.register(
    { name: 'deepcreator.conversation.embed.node', key: 'steering', locale: NS }, UserMessageNodeView))
  ctx.slots.inject('deepcreator.conversation.embed.node', () => ctx.slots.register(
    { name: 'deepcreator.conversation.embed.node', key: 'context', locale: NS }, ContextMessageNodeView))
  ctx.slots.inject('deepcreator.conversation.embed.node', () => ctx.slots.register(
    { name: 'deepcreator.conversation.embed.node', key: 'assistant-step', locale: NS }, AssistantNodeView))
  ctx.slots.inject('deepcreator.conversation.embed.node', () => ctx.slots.register(
    { name: 'deepcreator.conversation.embed.node', key: 'command', locale: NS }, EmbedQuietNode))
  ctx.slots.inject('deepcreator.conversation.embed.node', () => ctx.slots.register(
    { name: 'deepcreator.conversation.embed.node', key: 'manual-compaction', locale: NS }, ManualCompactionNodeView))
  ctx.slots.inject('deepcreator.conversation.embed.node', () => ctx.slots.register(
    { name: 'deepcreator.conversation.embed.node', key: 'compaction', locale: NS }, CompactionNodeView))
  ctx.slots.inject('deepcreator.conversation.embed.node', () => ctx.slots.register(
    { name: 'deepcreator.conversation.embed.node', key: 'model-retry', locale: NS }, RetryNodeView))
  ctx.slots.inject('deepcreator.conversation.embed.node', () => ctx.slots.register(
    { name: 'deepcreator.conversation.embed.node', key: 'turn-error', locale: NS }, TurnErrorNodeView))
  ctx.slots.inject('deepcreator.conversation.embed.node', () => ctx.slots.register(
    { name: 'deepcreator.conversation.embed.node', key: 'turn-max-tokens', locale: NS }, TurnMaxTokensNodeView))
  ctx.slots.inject('deepcreator.conversation.embed.node', () => ctx.slots.register(
    { name: 'deepcreator.conversation.embed.node', key: 'turn-tail', locale: NS }, EmbedQuietNode))
  ctx.slots.inject('deepcreator.conversation.embed.node', () => ctx.slots.register(
    { name: 'deepcreator.conversation.embed.node', key: 'unknown', locale: NS }, UnknownNodeView))
}
