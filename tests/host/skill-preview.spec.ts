import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadFileAddressFor, previewAddressFor, resolveInstructionFile } from '../../src/host/skill-preview.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

describe('resolveInstructionFile', () => {
  it('keeps the provider-reported path untouched', () => {
    expect(resolveInstructionFile('/reported/SKILL.md', '/elsewhere')).toBe('/reported/SKILL.md');
    expect(resolveInstructionFile('/reported/SKILL.md', '')).toBe('/reported/SKILL.md');
  });

  it('probes the canonical SKILL.md of a directory bundle that reports no path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capability-panel-skill-'));
    tempDirs.push(dir);
    writeFileSync(join(dir, 'SKILL.md'), '---\nname: demo\n---\n');
    expect(resolveInstructionFile('', dir)).toBe(join(dir, 'SKILL.md'));
  });

  it('reports nothing for a directory without SKILL.md, and for no directory at all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'capability-panel-skill-'));
    tempDirs.push(dir);
    // A provider naming its instruction file differently keeps no preview
    // entry rather than a guessed wrong one (e.g. the badge skill's
    // dsh-badge.md).
    writeFileSync(join(dir, 'dsh-badge.md'), 'body');
    expect(resolveInstructionFile('', dir)).toBe('');
    expect(resolveInstructionFile('', '')).toBe('');
  });
});

describe('skill preview addresses', () => {
  it('addresses an instruction file through the host helper', async () => {
    const forFile = await loadFileAddressFor();
    expect(forFile).toBeTypeOf('function');
    // Workspace-relative inside the session workspace, absolute outside it —
    // the two forms the host's own skill references produce.
    expect(previewAddressFor(forFile, 's1', '/ws', '/ws/.dsh/skills/demo/SKILL.md'))
      .toBe('dsh-resource://file/session/s1/.dsh/skills/demo/SKILL.md');
    expect(previewAddressFor(forFile, 's1', '/ws', '/home/u/.dsh/skills/demo/SKILL.md'))
      .toBe('dsh-resource://file/session/s1//home/u/.dsh/skills/demo/SKILL.md');
    // A Windows path keeps its drive colon literal, as the host's grammar says.
    expect(previewAddressFor(forFile, 's1', undefined, 'C:/Users/u/.dsh/skills/demo/SKILL.md'))
      .toBe('dsh-resource://file/session/s1/C:/Users/u/.dsh/skills/demo/SKILL.md');
  });

  it('probes the host package once per process', async () => {
    const first = await loadFileAddressFor();
    const second = await loadFileAddressFor();
    expect(second).toBe(first);
  });

  it('reports no address when the host exposes no such helper', async () => {
    vi.resetModules();
    vi.doMock('@deepseek-ai/dsh-util-workspace-path', () => ({ fileAddressFor: 'not a function' }));
    const { loadFileAddressFor: load } = await import('../../src/host/skill-preview.js');
    await expect(load()).resolves.toBeUndefined();
    vi.doUnmock('@deepseek-ai/dsh-util-workspace-path');
  });

  it('reports no address when the package cannot be loaded at all', async () => {
    vi.resetModules();
    vi.doMock('@deepseek-ai/dsh-util-workspace-path', () => { throw new Error('absent'); });
    const { loadFileAddressFor: load } = await import('../../src/host/skill-preview.js');
    await expect(load()).resolves.toBeUndefined();
    vi.doUnmock('@deepseek-ai/dsh-util-workspace-path');
  });

  it('reports no address for a host that cannot be asked at all', () => {
    expect(previewAddressFor(undefined, 's1', '/ws', '/ws/SKILL.md')).toBeUndefined();
  });
});