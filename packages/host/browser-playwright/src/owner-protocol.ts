import type { BrowserDescriptor, BrowserErrorCode, ProviderTab } from '@ryanyujazz/dsh-browser'
import type { PlaywrightScriptResult } from './script-isolate.ts'

export interface OwnerRequest { kind: 'request'; id: string; method: string; params: Record<string, unknown> }
export interface OwnerCancel { kind: 'cancel'; id: string }
export interface OwnerPolicyResponse { kind: 'policy-response'; id: string; ok: boolean; error?: string }
export type OwnerInput = OwnerRequest | OwnerCancel | OwnerPolicyResponse
export interface OwnerReady { kind: 'ready'; descriptors: BrowserDescriptor[] }
export interface OwnerResponse { kind: 'response'; id: string; ok: boolean; result?: unknown; error?: { code: BrowserErrorCode; message: string; details?: Record<string, unknown> } }
export interface OwnerPolicyRequest { kind: 'policy'; id: string; requestId: string; type: string; method: string; summary: { urls: string[]; origin?: string } }
export type OwnerOutput = OwnerReady | OwnerResponse | OwnerPolicyRequest
export interface OwnerScriptResult extends PlaywrightScriptResult { providerTabs: Array<{ engine: 'chromium' | 'firefox' | 'webkit'; tab: ProviderTab }> }
