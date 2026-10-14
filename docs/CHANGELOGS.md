# autoGamer 变更历史（CHANGELOGS）

> 只记**已经发生并结案**的变更：每条是一个 `### #N` 条目，含「问题描述 / 整改方案与实施 / 验收标准」三段。
> 在办事项、差距与方案在 [`TODO.md`](TODO.md)，不写在这里。
> **编号一经发布不得改写**：本分支从 **#84** 起续号（归档分支 `legacy-fork-v2-dsh-plugin` 的 CHANGELOGS 用到 #83）——
> 继续编号而不是从 #1 重开，是为了让「某个 #N 指某件事」在整仓历史里唯一，避免新旧两套编号同名不同事。
> 本文件建立**之前**已结清的事项（搬迁-1、基建-1、G81、前置-3、前置-4、基建-2）不在此追记：它们的记录在 `TODO.md` §七 各自条目，这里只留指针。

## 索引

| 分类 | 条目 | 范围 |
|---|---|---|
| 一 · 插件边界与溯源 | #84, #85 | 外部来源的切断（rules 链拆除）与被判定不迁移能力的放弃记录（录屏/视频分析）。 |

## 写入规则

1. **判归属**：问题已修好并有验收证据 → 写这里；还没修 → 写 `TODO.md` 差距行；只是方案/验收清单 → 写 `TODO.md` 主题条目。
2. **取号**：`### #N` 取当前最大号 +1，**永不复用、永不重排**。
3. **写三段**：`#### 问题描述`（含实测证据与出处）/ `#### 整改方案与实施`（改了哪些文件、为什么这么改）/ `#### 验收标准`（可复跑的命令或勾选项）。
4. **与 TODO 的交接**：条目若关闭某个 `G*` 或主题项，正文写在这里，`TODO.md` 只保留一行指针——**同一事实只在一处展开**。
5. **防膨胀**：单条超过约 60 行时，把调研正文移进 `docs/migration/`，本文件留结论 + 链接。

---

## 一 · 插件边界与溯源

### #84 rules 注入链拆除（D20 红线；主题项 rules-1）

#### 问题描述

- `rulesInjector` 把 `<artemisRepoPath>/mcp_server/rules.md` —— 一个**外部 ARTEMIS 仓库里的文件** —— 读进 `systemPrompt.section()`，每次挂载重读。外部仓库的目录约定与其中文本因此进入本插件的模型面。
- 取证：**前置-4 §三** 判定这条链同时踩 D19（仓内不承载 py 约定）与 D20（上游 prompt 正文不得进本项目模型面），归属 G85+G86，要求 T4 定案。
- 形式调研（随包文档 `@deepseek-ai/dsh-system-prompt/README.zh.md`，R1 允许面）：**「部署方编写的提示词文本只来自配置／组合……不存在终端用户提示词编辑 API」**；
  且 persona 与插件文本「在每次请求中重复」（常驻文本有每请求成本，过程性知识更适合按需形态）。
- 现状清点：本 bundle 的 `cordis.patch.yml` persona 行（常驻、agent 作用域）与 `skills/autogamer-flash/SKILL.md`（按需）**本就承载同族操作纪律** —— 外部文件那条是重复的第三条链。

#### 整改方案与实施

- **拆除而非「改指向」**（改指向会引入第三份重复文本，并把 agent 作用域的纪律放大成 profile 全局的 `section()`）。
- 删除面：`src/prompt/rulesInjector.ts`、`src/index.ts` 的 `injectRules` 配置与调用点、`src/tools/diagnose.ts` 的 rules 项及其文案、
  `tests/rulesInjector.spec.ts`、`tests/fixtures/fake-repo/`、`tests/apply.spec.ts` 与 `tests/conformance/contracts.spec.ts` 的相关断言、插件 `README.md` 的 Layout 行。
- 连带：`systemPrompt` 缝（`src/dsh-types.ts` 的手镜像、`inject` 条目、`runtimeBoot.spec.ts` 的 Tier-1 断言）随链一并消失。
  **引导图保留 `@deepseek-ai/dsh-system-prompt`**：agent loop 经它解析，删掉会让挂载失败——五条 mount 测试变红即证。
- 不加替代实现；规则文本的载体是 persona（常驻）与 skill（按需）。

#### 验收标准

- `grep -rn 'rulesInjector\|injectRules\|rulesFilePath\|mcp_server/rules' plugins/ | grep -v node_modules` → **0 命中**（含 `dist/`；陈旧构建产物已清）。
- R27 变异：把 `injectRules` 塞回 Config schema ⇒ `tests/conformance/contracts.spec.ts` 的字段锁**恰好那一条变红**；撤回复绿。
- `pnpm --config.verify-deps-before-run=false run verify` 三段全绿；`node scripts/check-docs.mjs` 与 `node scripts/check-env.mjs` exit 0。
- 提交：方案 `011a642`（R22 先方案后实现）→ 实现 `01de3b2`。

### #85 录屏 / 视频分析不迁移（D12 放弃记录）

#### 问题描述

- 规格 §一.4 要求：任何被判定不迁移的能力必须在**本分支**留下明确的放弃记录，不允许静默消失。
- 上游的录屏 / 视频分析能力（py `ffmpeg` 系）在 **D12** 已判「一期无录像」，但本分支新建 CHANGELOGS 之前一直没有落点。

#### 整改方案与实施

- 不实现任何替代载体；规格 §二 矩阵该行标注放弃并指向本条。本条即该放弃记录的落点（CHANGELOGS 于本分支首次结案时新建，见 #84）。

#### 验收标准

- 规格 §二「录屏 / 视频分析」行的状态列含 **已砍（CHANGELOGS #85）**；`node scripts/check-docs.mjs` exit 0。