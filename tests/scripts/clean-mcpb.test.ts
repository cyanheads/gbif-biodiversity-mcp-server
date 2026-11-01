/**
 * @fileoverview Regression tests for the agent-doc selector that
 * scripts/clean-mcpb.ts strips from a packed `.mcpb` and scripts/lint-packaging.ts
 * check 8 reports in a built one. Agent docs (`framework-skills/`, `skills/`,
 * `.claude/`, `.agents/`, `SKILL.md`) are matched only at an installed package's
 * root, so runtime modules under a nested `skills/` directory — the MCP SDK's
 * `dist/ext/skills/`, which a cleaned bundle needs to start — ship, and so does
 * the bundle's own root `skills/` tree. Imports the real implementations.
 * @module tests/scripts/clean-mcpb.test
 */

import { describe, expect, it } from 'vitest';
import {
  AGENT_DOC_ENTRY as CLEAN_AGENT_DOC_ENTRY,
  filterAgentDocEntries,
} from '../../scripts/clean-mcpb.js';
import { AGENT_DOC_ENTRY, checkBundleEntries } from '../../scripts/lint-packaging.js';

/** The SDK skills-extension modules `@modelcontextprotocol/server` 2.4.0 imports at startup. */
const SDK_SKILLS_RUNTIME = [
  'node_modules/@modelcontextprotocol/server/dist/ext/skills/',
  'node_modules/@modelcontextprotocol/server/dist/ext/skills/index.mjs',
  'node_modules/@modelcontextprotocol/core/dist/ext/skills/',
  'node_modules/@modelcontextprotocol/core/dist/ext/skills/index.mjs',
  'node_modules/@cyanheads/mcp-ts-core/node_modules/@modelcontextprotocol/server/dist/ext/skills/index.mjs',
];

/** Agent docs at an installed package's root — scoped, unscoped, and nested installs. */
const PACKAGE_ROOT_AGENT_DOCS = [
  'node_modules/dotenv/skills/',
  'node_modules/dotenv/skills/dotenv/SKILL.md',
  'node_modules/@cyanheads/mcp-ts-core/framework-skills/add-tool/SKILL.md',
  'node_modules/thread-stream/.claude/settings.json',
  'node_modules/nanoid/.agents/notes.md',
  'node_modules/some-pkg/SKILL.md',
  'node_modules/@scope/pkg/SKILL.md',
  'node_modules/@scope/pkg/skills/pkg-guide/SKILL.md',
  'node_modules/a/node_modules/b/skills/b-guide/SKILL.md',
  'node_modules/a/node_modules/@s/b/.claude/settings.json',
];

describe('clean-mcpb · agent-doc entry filter', () => {
  it('keeps the MCP SDK skills-extension modules, scoped and nested', () => {
    expect(filterAgentDocEntries(SDK_SKILLS_RUNTIME)).toEqual([]);
  });

  it('keeps a skills/ directory below a package root, and a package named skills', () => {
    const entries = [
      'node_modules/some-pkg/lib/skills/loader.js',
      'node_modules/@acme/skills/index.js',
      'node_modules/skills/index.js',
    ];
    expect(filterAgentDocEntries(entries)).toEqual([]);
  });

  it('keeps a SKILL.md inside a package tree, below its root', () => {
    expect(filterAgentDocEntries(['node_modules/some-pkg/dist/assets/SKILL.md'])).toEqual([]);
  });

  it("keeps the bundle's own root skills/ tree", () => {
    const entries = [
      'skills/',
      'skills/gbif-biodiversity-guide/SKILL.md',
      'skills/gbif-biodiversity-guide/references/identifiers.md',
    ];
    expect(filterAgentDocEntries(entries)).toEqual([]);
  });

  it('strips agent docs at an installed package root, in listing order', () => {
    const entries = [
      'dist/index.js',
      ...SDK_SKILLS_RUNTIME,
      ...PACKAGE_ROOT_AGENT_DOCS,
      'skills/gbif-biodiversity-guide/SKILL.md',
    ];
    expect(filterAgentDocEntries(entries)).toEqual(PACKAGE_ROOT_AGENT_DOCS);
  });

  it('does not match near-miss names or root dev paths', () => {
    const entries = [
      // Root-level dev dirs are .mcpbignore territory, not the nested strip's.
      'framework-skills/add-tool/SKILL.md',
      '.claude/settings.json',
      'node_modules/foo/skillsets/index.js',
      'node_modules/foo/MYSKILL.md',
      'node_modules/foo/dist/skills.js',
    ];
    expect(filterAgentDocEntries(entries)).toEqual([]);
  });
});

describe('lint-packaging · check 8 agent-doc class, paired with clean-mcpb', () => {
  it('uses the same selector as clean-mcpb.ts', () => {
    expect(AGENT_DOC_ENTRY.source).toBe(CLEAN_AGENT_DOC_ENTRY.source);
    expect(AGENT_DOC_ENTRY.flags).toBe(CLEAN_AGENT_DOC_ENTRY.flags);
  });

  it('passes a cleaned bundle that keeps the SDK skills modules and root skills/', () => {
    const entries = [
      'manifest.json',
      'dist/index.js',
      'skills/gbif-biodiversity-guide/SKILL.md',
      ...SDK_SKILLS_RUNTIME,
    ];
    expect(checkBundleEntries(entries, 'dist/test.mcpb')).toEqual([]);
  });

  it('flags agent docs left at a package root, counting only those', () => {
    const entries = ['dist/index.js', ...SDK_SKILLS_RUNTIME, ...PACKAGE_ROOT_AGENT_DOCS];
    const errors = checkBundleEntries(entries, 'dist/test.mcpb');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      `dist/test.mcpb contains ${PACKAGE_ROOT_AGENT_DOCS.length} node_modules agent-doc entries`,
    );
    expect(errors[0]).not.toContain('@modelcontextprotocol');
  });
});
