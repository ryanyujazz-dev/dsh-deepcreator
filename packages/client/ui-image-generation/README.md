# Image generation UI

Client companion for `@ryanyujazz/dsh-image-generation`. It contributes the `image-generation` card to the official Plugins settings namespace, a keyed `create_image` tool row, and an additive generated-media turn row before Artifact and Review cards.

Each generated image declares the optional `deepcreator.image-generation.result.action` list Slot. External features can add actions without importing internal components, while an empty Slot renders nothing.

In ExecFlow render modes, an expanded `create_image` row uses the shared icon-axis rail and aligns its generated image or diagnostic body with the 22px title column, matching the generic Tool row hierarchy. Final-answer generated images are rendered individually at 50% of the conversation flow width with their attachment aspect ratio, before Artifact and Review cards.

The settings contribution follows the official disclosure-card hierarchy. Its expanded view lists saved providers as compact credential-status rows, offers preset and custom provider entry points, and keeps add/edit drafts local until Save succeeds. Preset setup exposes only Provider and API key before progressively disclosing endpoint and model-catalog customization; provider IDs and credential references remain derived implementation details.

Preset providers start from the current native endpoints and model IDs: OpenAI Images uses `https://api.openai.com/v1` with `gpt-image-2`, Seedream uses `https://ark.cn-beijing.volces.com/api/v3` with `doubao-seedream-5-0-260128`, and Gemini uses `https://generativelanguage.googleapis.com/v1beta` with `gemini-3.1-flash-image` (displayed as Nano Banana 2). These values remain editable before saving.
