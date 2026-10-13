# Development model operating policy

[日本語](./MODEL_POLICY.ja.md)

## Basic policy

Assign bounded refinement to Luna, design and implementation to Sol, and high-impact independent audits to Astra, rather than assigning every stage to Astra. Models alone do not guarantee quality: combine machine verification against current inputs, review in separate sessions, counterexamples and failure injection.

The authoritative files are `.takt/runtime.yaml` and `.takt/workflows/platform-lifecycle.yaml`. Verify resolved assignments through regression tests and `npm run platform:routing`, which uses the actual TAKT 0.70.0 compiler and promotion resolver. Revalidate private API dependencies when updating TAKT. Do not change global Codex/TAKT settings.

| Profile | Model | Reasoning setting | Purpose |
|---|---|---|---|
| economical | gpt-6-luna | low | Initial goal refinement, roadmap and internal assistant/selector |
| builder | gpt-6.1-sol | medium | Architecture design, Kernel, store demo, BCP and release |
| reviewer | gpt-6.1-sol | high | Goal, roadmap and store demo review; completion retry judge |
| critical | gpt-6-astra | high | Architecture, foundation, BCP, final audit and loop judge |

## Promotion on revisits

- `frame-goal`, `plan-roadmap`: Luna/low on the first visit, Sol/medium on the second, Astra/high from the third.
- `design-architecture`, `build-foundation`, `build-store-demo`, `build-bcp`, `harden-release`: Sol/medium on the first and second visits, Astra/high from the third.
- The four critical audit steps use Astra/high from the outset. Ordinary reviews use Sol/high.

A revisit is a step execution count within the same workflow, including reruns after command-gate failures. It does not automatically recognize problem difficulty. Implementers and reviewers remain in separate sessions after promotion; do not weaken ACs or checks to force convergence. After three rounds of a major loop, an Astra judge reviews information gain and the need for human judgment.

## Why GPT-5.6 models were not the default

An older generation is not necessarily cheaper. Standard API prices on official model pages checked on 2026-10-12 were as follows, per million tokens for short contexts, shown as input/output:

| Comparison | GPT-5.6 models | Models used here |
|---|---|---|
| Small | 5.6 Luna: $0.20 / $1.20 | 6 Luna: $0.10 / $0.50 |
| Main | 5.6 Sol: $4.00 / $20.00 | 6.1 Sol: $2.00 / $10.00 |

Sources: [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol). Recheck prices, cached input, long-context and processing-tier conditions in official documentation at the time of use.

This compares API prices, not the billing or allowance for the ChatGPT authentication used here. Replacement with GPT-5.6 is not prohibited, but requires configuration changes, the same regression tests and connection checks, and rerunning machine verification. Do not fall back to another model without authorization after authentication/rate-limit faults or create new paid resources.

## CLI and connection checks

`scripts/codex-runtime.mjs` compares the CLI on PATH with the one bundled in the macOS app and selects the newer one only for the project's launch environment. An explicit `TAKT_CODEX_CLI_PATH` is respected; a broken explicit selection is not silently replaced.

In this environment, PATH version 0.144.5 could not use the specified models. App-bundled version 0.162.0-alpha.17.2 passed brief connection checks through TAKT's CodexProvider for Luna/low, Sol/medium, Sol/high and Astra/high. The same result is not guaranteed after app updates or on another machine, so recheck before launch.

`npm run platform:models` runs a brief readonly prompt that requests no file edits or tool execution under four configurations and saves results to `evidence/model-smoke.json`. Receipts are valid for 24 hours and only when the actual merged runtime and selected CLI path/version match. CLI/auth/model errors stop launch. Authentication alone does not count as a pass. This is not a test proving substantial model implementation quality or product quality.

`npm run platform:run` / `platform:watch` / `platform:start` use the same isolated queue after strict preflight. They reject provider/model/runtime environment overrides, uncommitted specifications and stale machine-verification receipts. Direct `npx takt run` bypasses these connection and freshness checks and must not be used for normal startup.

## Limits of cost management and stopping

The initial run is limited to 60 steps. Each step includes multiple model calls for implementation, judgment and reporting, and loop judges and verification commands also run. Thus 60 is not a cap on calls, tokens or spending. There is currently no spending-based forced stop.

After reaching the limit, a human checks run reports, remaining ACs, repetitions of the same defect and the account allowance. Requeue from the resume point, then use `npm run platform:run -- --ignore-exceed` only after explicitly deciding to continue. This option ignores only the step limit, not quality gates or permission boundaries.

New billing, external publication, pushes/PRs, real data, credential changes and writeback to existing environments are stop conditions. Initial permission covers only development model use through the existing account; it does not authorize requiring paid models as product dependencies.
