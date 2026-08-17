import type { Context } from '@deepseek-ai/cordis'

export interface TypertLookup<Host, Wire> {
  readonly host: Host
  readonly wire: Wire
}

export interface TypertContextMap {}
export interface TypertLookupMap {}
export interface TypertContext<Wire> { readonly wire: Wire }

export interface TypertGatewayBindingOptions { readonly namespace?: string }
export type RemoteMethodDecorator = <This extends object, Args extends unknown[], Result>(
  method: (this: This, ...args: Args) => Result,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
) => void

export declare abstract class TypertRemoteService {
  protected readonly ctx: Context
  protected constructor(ctx: Context, serviceKey: string, options?: TypertGatewayBindingOptions)
}

export declare function Remote<This extends object, Args extends unknown[], Result>(
  method: (this: This, ...args: Args) => Result,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
): void
export declare function Remote(exportName: string): RemoteMethodDecorator
