# gbif-biodiversity-mcp-server - Directory Structure

Generated on: 2026-09-20 15:07:06

```text
gbif-biodiversity-mcp-server/
├── .claude-plugin/
│   └── plugin.json
├── .codex-plugin/
│   ├── mcp.json
│   └── plugin.json
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml
│   │   ├── config.yml
│   │   └── feature_request.yml
│   ├── workflows/
│   │   └── codeql.yml
│   ├── CODE_OF_CONDUCT.md
│   ├── CONTRIBUTING.md
│   ├── FUNDING.yml
│   └── SECURITY.md
├── .vscode/
│   ├── extensions.json
│   └── settings.json
├── changelog/
│   ├── 0.1.x/
│   ├── 0.2.x/
│   ├── 0.3.x/
│   ├── 0.4.x/
│   ├── 0.5.x/
│   ├── 0.6.x/
│   ├── 0.7.x/
│   └── template.md
├── docs/
│   ├── design.md
│   └── idea.md
├── framework-skills/
│   ├── add-app-tool/
│   │   └── SKILL.md
│   ├── add-prompt/
│   │   └── SKILL.md
│   ├── add-resource/
│   │   └── SKILL.md
│   ├── add-service/
│   │   └── SKILL.md
│   ├── add-test/
│   │   └── SKILL.md
│   ├── add-tool/
│   │   └── SKILL.md
│   ├── api-auth/
│   │   └── SKILL.md
│   ├── api-canvas/
│   │   └── SKILL.md
│   ├── api-config/
│   │   └── SKILL.md
│   ├── api-context/
│   │   └── SKILL.md
│   ├── api-errors/
│   │   └── SKILL.md
│   ├── api-linter/
│   │   └── SKILL.md
│   ├── api-mirror/
│   │   └── SKILL.md
│   ├── api-services/
│   │   ├── references/
│   │   │   ├── graph.md
│   │   │   ├── llm.md
│   │   │   └── speech.md
│   │   └── SKILL.md
│   ├── api-telemetry/
│   │   └── SKILL.md
│   ├── api-testing/
│   │   └── SKILL.md
│   ├── api-utils/
│   │   ├── references/
│   │   │   ├── formatting.md
│   │   │   ├── parsing.md
│   │   │   └── security.md
│   │   └── SKILL.md
│   ├── api-workers/
│   │   └── SKILL.md
│   ├── code-simplifier/
│   │   └── SKILL.md
│   ├── design-mcp-server/
│   │   └── SKILL.md
│   ├── field-test/
│   │   └── SKILL.md
│   ├── git-wrapup/
│   │   └── SKILL.md
│   ├── maintenance/
│   │   └── SKILL.md
│   ├── orchestrations/
│   │   ├── workflows/
│   │   │   ├── field-test-fix.md
│   │   │   ├── fix-wrapup-release.md
│   │   │   ├── greenfield-build.md
│   │   │   └── maintenance-release.md
│   │   └── SKILL.md
│   ├── polish-docs-meta/
│   │   ├── references/
│   │   │   ├── agent-protocol.md
│   │   │   ├── package-meta.md
│   │   │   ├── readme.md
│   │   │   └── server-json.md
│   │   └── SKILL.md
│   ├── release-and-publish/
│   │   └── SKILL.md
│   ├── release-pr-review/
│   │   └── SKILL.md
│   ├── report-issue-framework/
│   │   └── SKILL.md
│   ├── report-issue-local/
│   │   └── SKILL.md
│   ├── security-pass/
│   │   └── SKILL.md
│   ├── setup/
│   │   └── SKILL.md
│   ├── techniques/
│   │   ├── references/
│   │   │   └── outline-on-overflow.md
│   │   └── SKILL.md
│   └── tool-defs-analysis/
│       └── SKILL.md
├── scripts/
│   ├── build-changelog.ts
│   ├── build.ts
│   ├── check-dependency-specifiers.ts
│   ├── check-docs-sync.ts
│   ├── check-framework-antipatterns.ts
│   ├── check-skill-versions.ts
│   ├── check-skills-sync.ts
│   ├── clean-mcpb.ts
│   ├── clean.ts
│   ├── devcheck.ts
│   ├── lint-mcp.ts
│   ├── lint-packaging.ts
│   ├── list-skills.ts
│   ├── release-github.ts
│   ├── split-changelog.ts
│   └── tree.ts
├── src/
│   ├── config/
│   │   └── server-config.ts
│   ├── mcp-server/
│   │   ├── prompts/
│   │   │   └── definitions/
│   │   ├── resources/
│   │   │   └── definitions/
│   │   │       ├── gbif-dataset.resource.ts
│   │   │       └── gbif-species.resource.ts
│   │   └── tools/
│   │       ├── definitions/
│   │       │   ├── gbif-bulk-match-species.tool.ts
│   │       │   ├── gbif-count-occurrences.tool.ts
│   │       │   ├── gbif-get-dataset.tool.ts
│   │       │   ├── gbif-get-occurrence.tool.ts
│   │       │   ├── gbif-get-species-children.tool.ts
│   │       │   ├── gbif-get-species-classification.tool.ts
│   │       │   ├── gbif-get-species.tool.ts
│   │       │   ├── gbif-match-species.tool.ts
│   │       │   ├── gbif-occurrence-facets.tool.ts
│   │       │   ├── gbif-search-datasets.tool.ts
│   │       │   ├── gbif-search-occurrences.tool.ts
│   │       │   ├── gbif-search-publishers.tool.ts
│   │       │   └── gbif-search-species.tool.ts
│   │       └── utils.ts
│   ├── services/
│   │   └── gbif/
│   │       ├── gbif-service.ts
│   │       └── types.ts
│   └── index.ts
├── tests/
│   ├── config/
│   │   └── server-config.test.ts
│   ├── prompts/
│   ├── resources/
│   │   ├── gbif-dataset.resource.test.ts
│   │   └── gbif-species.resource.test.ts
│   ├── services/
│   │   └── gbif-service.test.ts
│   ├── tools/
│   │   ├── annotations.test.ts
│   │   ├── gbif-bulk-match-species.tool.test.ts
│   │   ├── gbif-count-occurrences.tool.test.ts
│   │   ├── gbif-get-dataset.tool.test.ts
│   │   ├── gbif-get-occurrence.tool.test.ts
│   │   ├── gbif-get-species-children.tool.test.ts
│   │   ├── gbif-get-species-classification.tool.test.ts
│   │   ├── gbif-get-species.tool.test.ts
│   │   ├── gbif-match-species.tool.test.ts
│   │   ├── gbif-occurrence-facets.tool.test.ts
│   │   ├── gbif-search-datasets.tool.test.ts
│   │   ├── gbif-search-occurrences.tool.test.ts
│   │   ├── gbif-search-publishers.tool.test.ts
│   │   ├── gbif-search-species.tool.test.ts
│   │   ├── security.test.ts
│   │   └── utils.test.ts
│   └── credential-claims.test.ts
├── .dockerignore
├── .env.example
├── .gitattributes
├── .gitignore
├── .mcpbignore
├── AGENTS.md
├── biome.json
├── bun.lock
├── bunfig.toml
├── CHANGELOG.md
├── CITATION.cff
├── CLAUDE.md
├── devcheck.config.json
├── Dockerfile
├── LICENSE
├── manifest.json
├── package.json
├── README.md
├── server.json
├── tsconfig.build.json
├── tsconfig.json
└── vitest.config.ts
```

_Note: This tree excludes files and directories matched by .gitignore and default patterns._
