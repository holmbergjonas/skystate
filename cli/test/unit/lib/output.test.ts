import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { detectFormat, output, outputDetail, type TableConfig } from '../../../src/lib/output.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip ANSI escape codes for assertion on colored output. */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001B\[[0-9;]*m/g, '');
}

let stdoutData: string;
let writeSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stdoutData = '';
  writeSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation((chunk: string | Uint8Array) => {
      stdoutData += typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
      return true;
    });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// detectFormat
// ---------------------------------------------------------------------------

describe('detectFormat', () => {
  it('returns explicit format when provided', () => {
    expect(detectFormat('json')).toBe('json');
    expect(detectFormat('table')).toBe('table');
    expect(detectFormat('plain')).toBe('plain');
  });

  it('returns "table" when stdout is a TTY', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    expect(detectFormat()).toBe('table');
  });

  it('returns "json" when stdout is not a TTY (piped)', () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
    expect(detectFormat()).toBe('json');
  });
});

// ---------------------------------------------------------------------------
// output (list rendering)
// ---------------------------------------------------------------------------

describe('output', () => {
  const sampleData = [
    { name: 'proj-1', slug: 'proj-1' },
    { name: 'proj-2', slug: 'proj-2' },
  ];

  const sampleTable: TableConfig = {
    headers: ['NAME', 'SLUG'],
    rows: [
      ['proj-1', 'proj-1'],
      ['proj-2', 'proj-2'],
    ],
  };

  describe('json format', () => {
    it('writes valid JSON to stdout', () => {
      output(sampleData, sampleTable, { format: 'json' });
      const parsed = JSON.parse(stdoutData);
      expect(parsed).toEqual(sampleData);
    });

    it('writes pretty-printed JSON with trailing newline', () => {
      output(sampleData, sampleTable, { format: 'json' });
      expect(stdoutData).toBe(JSON.stringify(sampleData, null, 2) + '\n');
    });
  });

  describe('plain format', () => {
    it('writes tab-separated rows', () => {
      output(sampleData, sampleTable, { format: 'plain' });
      const lines = stdoutData.trimEnd().split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe('proj-1\tproj-1');
      expect(lines[1]).toBe('proj-2\tproj-2');
    });
  });

  describe('table format', () => {
    it('writes output containing header text', () => {
      output(sampleData, sampleTable, { format: 'table' });
      const plain = stripAnsi(stdoutData);
      expect(plain).toContain('NAME');
      expect(plain).toContain('SLUG');
    });

    it('writes output containing row data', () => {
      output(sampleData, sampleTable, { format: 'table' });
      const plain = stripAnsi(stdoutData);
      expect(plain).toContain('proj-1');
      expect(plain).toContain('proj-2');
    });
  });

  describe('quiet mode', () => {
    it('suppresses all output', () => {
      output(sampleData, sampleTable, { format: 'json', quiet: true });
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------
// outputDetail (single-item rendering)
// ---------------------------------------------------------------------------

describe('outputDetail', () => {
  const sampleDetail: Record<string, unknown> = {
    name: 'My Project',
    slug: 'my-project',
    created: '2026-01-01',
  };

  describe('json format', () => {
    it('writes valid JSON to stdout', () => {
      outputDetail(sampleDetail, { format: 'json' });
      const parsed = JSON.parse(stdoutData);
      expect(parsed).toEqual(sampleDetail);
    });
  });

  describe('plain format', () => {
    it('writes key-value pairs as tab-separated lines', () => {
      outputDetail(sampleDetail, { format: 'plain' });
      const lines = stdoutData.trimEnd().split('\n');
      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe('name\tMy Project');
      expect(lines[1]).toBe('slug\tmy-project');
      expect(lines[2]).toBe('created\t2026-01-01');
    });
  });

  describe('table format', () => {
    it('writes output containing key text', () => {
      outputDetail(sampleDetail, { format: 'table' });
      const plain = stripAnsi(stdoutData);
      expect(plain).toContain('NAME');
      expect(plain).toContain('SLUG');
      expect(plain).toContain('CREATED');
    });

    it('writes output containing values', () => {
      outputDetail(sampleDetail, { format: 'table' });
      const plain = stripAnsi(stdoutData);
      expect(plain).toContain('My Project');
      expect(plain).toContain('my-project');
    });
  });

  describe('quiet mode', () => {
    it('suppresses all output', () => {
      outputDetail(sampleDetail, { format: 'table', quiet: true });
      expect(writeSpy).not.toHaveBeenCalled();
    });
  });
});
