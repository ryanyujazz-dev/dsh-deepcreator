# Third-party notices

DeepCreator distributes the following dependencies and local web-font assets for code highlighting, Diff alignment, and Code Appearance. Their upstream licenses remain in effect.

| Component | Version | License | Use |
| --- | --- | --- | --- |
| [jsdiff (`diff`)](https://github.com/kpdecker/jsdiff) | 9.0.0 | BSD-3-Clause | Line and word Diff alignment |
| [Shiki themes](https://github.com/shikijs/shiki) | 4.4.3 | MIT | GitHub and One TextMate themes and theme loading |
| [JetBrains Mono via Fontsource](https://fontsource.org/fonts/jetbrains-mono) | 5.3.0 | OFL-1.1 | Locally bundled variable code font |
| [Fira Code via Fontsource](https://fontsource.org/fonts/fira-code) | 5.3.0 | OFL-1.1 | Locally bundled variable code font |
| [Source Code Pro via Fontsource](https://fontsource.org/fonts/source-code-pro) | 5.3.0 | OFL-1.1 | Locally bundled variable code font |
| [deepseek-harness development skills](https://github.com/deepseek-ai/deepseek-harness/tree/master/.agents/skills) | master | MIT | Eleven official skills bundled verbatim by `@ryanyujazz/dsh-skills` |

Only normal-style variable WOFF2 subsets referenced by the Code Appearance stylesheet are emitted into the Client bundle. System Mono uses the operating system font stack and adds no bundled font asset.
