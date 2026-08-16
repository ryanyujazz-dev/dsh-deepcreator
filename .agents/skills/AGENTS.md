# Repository skill instructions

This directory contains portable, repository-local skills for agents working on DeepCreator and DSH Cordis integrations.

- Every skill directory must contain one valid `SKILL.md` whose folder name matches its frontmatter `name`.
- Keep trigger conditions in the frontmatter `description`; keep the body procedural and under 500 lines.
- Do not add README, changelog, installation guide, or other auxiliary files inside an individual skill.
- Put detailed optional material one level below `references/`, reusable deterministic utilities under `scripts/`, and output resources under `assets/` only when needed.
- Keep generic DSH facts in the two `dsh-cordis-*` skills. Keep repository paths, package ownership, commands, and product invariants in `deepcreator-cordis-development`.
- The DeepCreator skill may route to sibling skills conditionally. Do not duplicate their complete content into its body.
- Update `agents/openai.yaml` when a skill's purpose or default prompt changes.
- Validate every changed skill with the Skill Creator `quick_validate.py` before handoff.
- Skills guide agents but do not replace root or nested `AGENTS.md` requirements.
