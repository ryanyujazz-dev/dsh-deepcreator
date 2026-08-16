# @ryanyujazz/dsh-client-compat

DeepCreator's compile-time compatibility face for the official Harness client runtime and slot APIs. It records the supported Harness package version and source SHA, and exports only stable public types. Runtime objects continue to come from the official ModuleLoader table; this package does not copy Session, Runtime, RPC, or UI implementations.
