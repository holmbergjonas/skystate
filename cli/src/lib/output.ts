/**
 * Output formatter with auto-detect, table/json/plain rendering, and --quiet.
 *
 * Every command uses output() for list views and outputDetail() for single-item
 * detail views. The format is auto-detected from the environment (table for TTY,
 * json for pipe) but can be overridden with --format.
 *
 * - json: Structured JSON to stdout (machine-readable)
 * - plain: Tab-separated values (pipes to cut/awk/sort)
 * - table: Borderless cli-table3 with colored headers (human-readable)
 */

import Table from 'cli-table3';
import { colors } from './colors.js';

export type OutputFormat = 'table' | 'json' | 'plain';

export interface OutputOptions {
  format?: OutputFormat;
  quiet?: boolean;
}

/**
 * Detect output format from explicit flag or environment.
 * Returns explicit format if provided, otherwise table for TTY, json for pipe.
 */
export function detectFormat(explicit?: OutputFormat): OutputFormat {
  if (explicit) return explicit;
  return process.stdout.isTTY ? 'table' : 'json';
}

export interface TableConfig {
  headers: string[];
  rows: string[][];
}

/**
 * Render list data in the detected format.
 *
 * @param data - Raw data object for json format
 * @param tableConfig - Headers and rows for table/plain format
 * @param opts - Format override and quiet flag
 */
export function output(
  data: unknown,
  tableConfig: TableConfig,
  opts: OutputOptions,
): void {
  if (opts.quiet) return;

  const format = detectFormat(opts.format);

  switch (format) {
    case 'json':
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      break;

    case 'plain':
      for (const row of tableConfig.rows) {
        process.stdout.write(row.join('\t') + '\n');
      }
      break;

    case 'table': {
      const table = new Table({
        head: tableConfig.headers.map((h) => colors.header(h)),
        chars: {
          top: '',
          'top-mid': '',
          'top-left': '',
          'top-right': '',
          bottom: '',
          'bottom-mid': '',
          'bottom-left': '',
          'bottom-right': '',
          left: '',
          'left-mid': '',
          mid: '',
          'mid-mid': '',
          right: '',
          'right-mid': '',
          middle: '',
        },
        style: {
          'padding-left': 1,
          'padding-right': 3,
        },
      });
      table.push(...tableConfig.rows);
      process.stdout.write(table.toString() + '\n');
      break;
    }
  }
}

/**
 * Render single-item detail data as key-value pairs.
 * Matches gh pr view style: uppercase keys with aligned values.
 *
 * @param data - Key-value record for the detail view
 * @param opts - Format override and quiet flag
 */
export function outputDetail(
  data: Record<string, unknown>,
  opts: OutputOptions,
): void {
  if (opts.quiet) return;

  const format = detectFormat(opts.format);

  switch (format) {
    case 'json':
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      break;

    case 'plain':
      for (const [key, value] of Object.entries(data)) {
        process.stdout.write(`${key}\t${String(value)}\n`);
      }
      break;

    case 'table': {
      const table = new Table({
        chars: {
          top: '',
          'top-mid': '',
          'top-left': '',
          'top-right': '',
          bottom: '',
          'bottom-mid': '',
          'bottom-left': '',
          'bottom-right': '',
          left: '',
          'left-mid': '',
          mid: '',
          'mid-mid': '',
          right: '',
          'right-mid': '',
          middle: '',
        },
        style: {
          'padding-left': 1,
          'padding-right': 3,
        },
      });
      for (const [key, value] of Object.entries(data)) {
        table.push([colors.label(key.toUpperCase()), colors.value(String(value))]);
      }
      process.stdout.write(table.toString() + '\n');
      break;
    }
  }
}
