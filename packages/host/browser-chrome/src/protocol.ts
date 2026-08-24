import type { BrowserCommand, BrowserCommandResult, BrowserErrorCode, BrowserErrorDetails, ProviderTab, UserTabCandidate } from '@ryanyujazz/dsh-browser'

export interface ChromeBridgeRequest { id: string; method: string; params: unknown }
export interface ChromeBridgeResponse { id: string; ok: boolean; result?: unknown; error?: { code: BrowserErrorCode; message: string; details?: BrowserErrorDetails } }
export type ChromeBridgeNotification =
  | { event: 'control-interrupted'; providerTabId: string }
  | { event: 'state-changed'; providerTabId: string }
  | { event: 'network-request'; providerTabId: string; decisionId: string; url: string }
export interface ChromeNetworkDecision { kind: 'network-decision'; decisionId: string; allow: boolean; message?: string }
export interface ChromeCreateParams { request: { url?: string }; automationSessionId: string }
export interface ChromeExecuteParams { providerTabId: string; command: BrowserCommand }
export type ChromeProviderResult = ProviderTab | UserTabCandidate[] | BrowserCommandResult | null
