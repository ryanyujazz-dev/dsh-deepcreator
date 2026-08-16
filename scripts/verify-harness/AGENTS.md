# Harness verification instructions

This directory owns read-only checks against the supported official Harness package.

- Read the supported version and SHA from `packages/client/compat/compatibility.json`.
- Verify public packages, exports, Slot and Bundle assumptions used by DeepCreator. Do not depend on a neighboring source checkout.
- Report incompatible official changes explicitly and identify the affected package or protocol.
- Verification must not modify npm packages, profiles, user data, lockfiles, or generated output.
- Keep checks deterministic and runnable before an official upgrade is accepted.
