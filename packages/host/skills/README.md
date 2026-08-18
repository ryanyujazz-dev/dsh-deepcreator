# Bundled official DeepSeek Harness skills

Host package registering the eleven official [deepseek-harness development skills](https://github.com/deepseek-ai/deepseek-harness/tree/master/.agents/skills) as one immutable provider on `ctx.skills`:

- `dsh-archive-agent-notes` — audit, prune, and archive Agent Notes
- `dsh-code-review` — review a deepseek-harness PR against its standards
- `dsh-doc-site-sync` — publish and maintain the documentation website
- `dsh-doc-standards` — apply the documentation hierarchy and tutorial standard
- `dsh-find-simplifications` — find non-obvious simplification candidates
- `dsh-merging-stacked-prs` — land a stack of dependent PRs
- `dsh-pre-push-checks` — select the smallest checks covering an outgoing diff
- `dsh-prose-standard` — prose standard across docs, comments, prompts, strings
- `dsh-translate-docs` — bilingual document workflow (user-invocable only)
- `dsh-trim-cot-leakage` — trim leaked reasoning-transcript prose
- `record-browser-gif` — record browser demos as optimized GIFs

The skill directories ship verbatim under `assets/skills/` (SKILL.md plus each skill's `agents/`, `references/`, and `scripts/` files). The provider parses each SKILL.md frontmatter with the official filesystem provider's semantics — `name`/`description` required, `disable-model-invocation` and `user-invocable` flags honored — serves the body with the packaged directory as the resource base, and registers with `BUNDLED_SKILL_RANK` so user-owned definitions override it through the ordinary registry precedence.

The DeepCreator bundle composes the plugin as `deepcreator-skills`; disabling that row is the opt-out. Package tests pin the catalog, frontmatter stripping, invocation policy, and packaged-resource resolution.
