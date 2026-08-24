/**
 * Chinese catalog descriptions for the immutable Skill bundles shipped by
 * this provider. English remains authoritative in each verbatim SKILL.md;
 * these strings are presentation metadata and never enter model prompts.
 */
export const ZH_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
  'dsh-archive-agent-notes': '用于在 deepseek-harness 中添加、审计、精简、归档、恢复或审查 Agent Notes；检查新笔记是否取代现有记录，按未来决策价值分类已实现笔记，删除不再能防止误判的已拒绝笔记，并执行固定的 archived/{kind} 三文件组与清单规则。',
  'dsh-browser-control': '通过语义化 Browser 工具选择并控制 DeepCreator 浏览器提供者。调用 browser_list、browser_tabs、browser_navigate、browser_inspect、browser_act、browser_wait 或 open_in_deepcreator 前必须阅读。',
  'dsh-code-review': '用于审查 deepseek-harness 仓库中的拉取请求；帮助审查者理解项目规范（AGENTS.md 约定、防御性模式、ADR 与质量门禁），并检查仅从代码中无法判断的审查事项。',
  'dsh-doc-site-sync': '用于发布、更新、移动或删除 DeepSeek Harness 文档站页面，编辑 website/docs.ts 映射或导航，诊断 VitePress 页面缺失，修复投影文档链接，以及在网站内容变更后运行 docs:dev、docs:check 和 doc-sync 工作流。',
  'dsh-doc-standards': '用于在 deepseek-harness 仓库中编写、移动、审查或审计文档，包括选择层级和详略、区分教程与参考资料、检查教程递进、精简冗余文案、处理 verify-doc-budgets 失败，以及“改进文档”“审计文档”“这段内容应写在哪里”或“文档太长”等请求。',
  'dsh-find-simplifications': '用于在 deepseek-harness 仓库中寻找不明显的简化机会，编写拟议的 Agent Notes 或行内 TODO/FIXME/XXX，审计或合并已被取代的 Agent Notes，或吸收其他 PR 中值得保留的简化思路；尤其适用于无用、重复、推测性、过度设计、添加后又移除，以及已有依赖却自行实现的代码。',
  'dsh-merging-stacked-prs': '用于将一组相互依赖的 GitHub PR（A ← B ← C）合并到 master，处理以上一个开放 PR 分支为基础的 PR，或处理“堆叠 PR”“PR 栈”“依赖 PR”及按顺序合并多个相关 PR 的请求。要求同仓库依赖链在合并前使用 GitHub 官方堆叠 PR 功能，由 GitHub 统一管理规则、CI、顺序、重定向和合并状态。',
  'dsh-playwright-control': '使用 DeepCreator 完整的 Playwright Library 工具执行高级浏览器自动化、多引擎测试、路由、事件、回调、跟踪、视频、下载、请求上下文和 CDP 操作。调用 playwright_run 前必须阅读。',
  'dsh-pre-push-checks': '用于推送、强制推送、标记为可审查或声称 deepseek-harness 分支检查通过之前，以及 gh stack sync 发布重写分支之后；选择能够覆盖待推送或刚发布差异的最小测试与检查集合，避免机械地运行整个仓库测试。',
  'dsh-prose-standard': '用于在 deepseek-harness 仓库中编写、审查、恢复、精简或审计文字，并判断 Markdown、JSDoc、代码与测试注释、提示词、描述、诊断信息以及 CLI 或 UI 文案中何处需要文档或说明。',
  'dsh-translate-docs': '手动运行扩展的 DeepSeek Harness 双语文档工作流，包括生成翻译简报、委派文字翻译、整篇文档翻译和限定范围的中英文配对验证。',
  'dsh-trim-cot-leakage': '用于审计或修复读起来像泄露推理过程的文字，包括失效的设计阶段引用、审计项编号、未提交草稿章节、变更过程叙述、PR 栈或审查视角、面向审查者的辩解、控制流叙述，以及注释、JSDoc、文档或 Agent Notes 中残留的试探性计划措辞。',
  'dsh-web-gui-tester': '使用 DeepCreator Browser 工具以图形化黑盒方式测试 Web 前端：模拟用户交互、结合结构化快照与截图交叉验证并报告结果。适用于测试网页、验证 UI 行为、复现页面问题或测试指定 URL。',
  'record-browser-gif': '使用可用的内置浏览器、基于状态的帧捕获和确定性编码，将浏览器或 Web UI 交互录制为优化后的 GIF；当任务需要把 GIF 附加到拉取请求时，再发布到专用资源分支。适用于制作、录制或生成浏览器流程演示 GIF；任何改变用户可见 GUI 行为的 PR 都必须包含基于该 PR 真实服务与模型流程录制的 GIF。',
})

const DEEPCREATOR_SKILLS = new Set([
  'dsh-browser-control',
  'dsh-playwright-control',
  'dsh-web-gui-tester',
])

/** Content author shown separately from the package/provider delivering it. */
export function developerFor(name: string): string {
  return DEEPCREATOR_SKILLS.has(name) ? 'DeepCreator' : 'DeepSeek Harness'
}
