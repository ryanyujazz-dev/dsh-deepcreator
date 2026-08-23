# Image generation

Host-side `create_image` capability. Provider profiles are stored in the official `image-generation` Settings namespace; API keys are referenced by environment-style credential names and resolved through the official Credentials service for every request.

`ImageGenerationRuntime` is the reversible public extension boundary for request middleware and result observers. Structured `input_images` assign semantic roles to attachment or workspace inputs; legacy `input_attachment_ids` and `input_paths` remain supported and normalize to `generic`.

The tool supports native OpenAI Images, Volcengine Ark Seedream, and Gemini image-generation endpoints. Every successful call creates exactly one workspace PNG and one durable image attachment.

OpenAI calls the native Images generation/edit endpoints, Seedream calls Ark `images/generations` with group output disabled, and Gemini calls the current Interactions `interactions` endpoint. Provider base URLs and model IDs remain settings-owned so deployments can override the presets without changing this package.

Provider requests and result downloads honor the Host process's standard `HTTPS_PROXY`, `HTTP_PROXY`, and `NO_PROXY` environment variables. Proxy credentials stay process-owned and are not copied into image-generation settings.

DeepCreator Desktop derives those variables from the operating system proxy/PAC route when no explicit deployment proxy exists. A network failure tells the Agent whether no proxy was available or an active proxy could not reach the Provider, with an actionable VPN/system-proxy remedy. Consecutive failures are tracked per Agent turn: the third failure tells the model to stop automatic retries, the fifth opens a hard circuit breaker, and later calls in that turn are rejected without contacting the Provider. A successful generation resets the streak, and a new user turn starts with a fresh retry budget.
