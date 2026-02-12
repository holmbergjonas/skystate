import { Command } from '@commander-js/extra-typings';
import { CliError, ApiError } from '../lib/errors.js';
import { readConfigFile, resolveConfigValue } from '../lib/config.js';
import { createHttpClient, type HttpClient } from '../lib/http-client.js';
import { resolveProject } from '../lib/slug-resolver.js';
import { resolveEnvironment } from '../lib/slug-resolver.js';
import { output, outputDetail, detectFormat, type OutputFormat } from '../lib/output.js';
import { withSpinner } from '../lib/spinner.js';
import { detectBump, computeNextVersion, generateUnifiedDiff, type BumpType } from '../lib/diff.js';
import { red, green, cyan, bold } from 'ansis';
import { requireInteractive, confirmYesNo } from '../lib/prompt.js';
import { getVersion } from '../lib/version.js';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Types matching API responses
interface ProjectConfigResponse {
  projectStateId: string;
  projectId: string;
  environment: string;
  major: number;
  minor: number;
  patch: number;
  state: string;
  comment: string | null;
  createdAt: string;
  stateSizeBytes: number;
}

interface PublicConfigResponse {
  version: { major: number; minor: number; patch: number };
  lastModified: string;
  config: unknown;
}

interface GlobalOpts {
  format?: OutputFormat;
  quiet?: boolean;
  verbose?: boolean;
  apiUrl?: string;
  project?: string;
  env?: string;
}

async function requireProjectAndEnv(
  opts: GlobalOpts,
  configFile: Record<string, string>,
  client: HttpClient,
): Promise<{ projectId: string; projectSlug: string; envSlug: string }> {
  const projectSlug =
    opts.project ?? resolveConfigValue('default_project', configFile).value;
  if (!projectSlug) {
    throw new CliError(
      'No project selected. Run: skystate projects select <slug>',
    );
  }
  const projectId = await resolveProject(client, projectSlug);

  const envSlug =
    opts.env ?? resolveConfigValue('default_env', configFile).value;
  if (!envSlug) {
    throw new CliError(
      'No environment selected. Run: skystate envs select <slug>',
    );
  }
  // Validate environment slug locally (no API call needed)
  resolveEnvironment(envSlug);

  return { projectId, projectSlug, envSlug };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export const configCommand = new Command('config')
  .description('Manage remote config');

configCommand
  .command('get')
  .description('Fetch the latest config as JSON')
  .action(async function () {
    const opts = this.optsWithGlobals() as GlobalOpts;

    const configFile = await readConfigFile();
    const apiUrl =
      opts.apiUrl ?? resolveConfigValue('api_url', configFile).value;
    const version = await getVersion();

    const client = createHttpClient({
      apiUrl,
      verbose: opts.verbose ?? false,
      version,
    });

    const { projectId, envSlug } = await requireProjectAndEnv(
      opts,
      configFile,
      client,
    );

    let data: ProjectConfigResponse;
    try {
      const res = await withSpinner('Fetching config...', () =>
        client.get<ProjectConfigResponse>(
          `/project/${projectId}/config/${envSlug}/latest`,
        ),
      );
      data = res.data;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        throw new CliError(
          'No config exists for this environment. Push config first: skystate config push <file>',
        );
      }
      throw err;
    }

    // Build metadata envelope per CONTEXT.md locked decision
    const configData = JSON.parse(data.state) as unknown;
    const envelope = {
      version: `${data.major}.${data.minor}.${data.patch}`,
      timestamp: data.createdAt,
      data: configData,
    };

    const format = detectFormat(opts.format as OutputFormat | undefined);

    if (opts.quiet) return;

    if (format === 'json' || format === 'plain') {
      // JSON and plain: output the full envelope as pretty-printed JSON
      process.stdout.write(JSON.stringify(envelope, null, 2) + '\n');
    } else {
      // Table format (TTY): key-value detail view
      const detailData: Record<string, unknown> = {
        version: envelope.version,
        timestamp: data.createdAt.split('T')[0] + ' ' + (data.createdAt.split('T')[1] ?? '').slice(0, 5),
        size: formatBytes(data.stateSizeBytes),
      };
      if (data.comment) {
        detailData.comment = data.comment;
      }
      detailData.data = JSON.stringify(configData, null, 2);

      outputDetail(detailData, {
        format: opts.format as OutputFormat | undefined,
        quiet: opts.quiet,
      });
    }
  });

configCommand
  .command('history')
  .description('List version history')
  .option('--limit <n>', 'Max versions to show', '50')
  .action(async function () {
    const localOpts = this.opts();
    const opts = this.optsWithGlobals() as GlobalOpts & { limit?: string };

    const configFile = await readConfigFile();
    const apiUrl =
      opts.apiUrl ?? resolveConfigValue('api_url', configFile).value;
    const version = await getVersion();

    const client = createHttpClient({
      apiUrl,
      verbose: opts.verbose ?? false,
      version,
    });

    const { projectId, envSlug } = await requireProjectAndEnv(
      opts,
      configFile,
      client,
    );

    const { data } = await withSpinner('Fetching version history...', () =>
      client.get<ProjectConfigResponse[]>(
        `/project/${projectId}/config/${envSlug}`,
      ),
    );

    // Apply limit
    const limit = parseInt(localOpts.limit ?? '50', 10);
    const limited = data.slice(0, limit);

    // Format for JSON output
    const jsonData = limited.map((s) => ({
      version: `${s.major}.${s.minor}.${s.patch}`,
      major: s.major,
      minor: s.minor,
      patch: s.patch,
      stateSizeBytes: s.stateSizeBytes,
      comment: s.comment,
      createdAt: s.createdAt,
    }));

    // Format for table
    const rows = limited.map((s) => {
      const ver = `${s.major}.${s.minor}.${s.patch}`;
      const size = formatBytes(s.stateSizeBytes);
      const comment = s.comment ?? '(no comment)';
      const dateParts = s.createdAt.split('T');
      const date = dateParts[0] + ' ' + (dateParts[1] ?? '').slice(0, 5);
      return [ver, size, comment, date];
    });

    output(jsonData, {
      headers: ['VERSION', 'SIZE', 'COMMENT', 'DATE'],
      rows,
    }, { format: opts.format as OutputFormat | undefined, quiet: opts.quiet });
  });

async function readInput(fileArg: string): Promise<string> {
  if (fileArg === '-') {
    if (process.stdin.isTTY) {
      throw new CliError(
        'No input on stdin. Pipe data: cat config.json | skystate config push -',
      );
    }
    const chunks: string[] = [];
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      chunks.push(chunk as string);
    }
    return chunks.join('');
  }

  const { readFile } = await import('node:fs/promises');
  try {
    return await readFile(fileArg, 'utf8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CliError(`File not found: ${fileArg}`);
    }
    throw new CliError(`Cannot read file: ${fileArg}`);
  }
}

configCommand
  .command('push')
  .argument('<file>', 'JSON file path or - for stdin')
  .description('Push a new config version')
  .option('--bump <type>', 'Version bump type (major|minor|patch)')
  .option('--comment <message>', 'Comment for this version')
  .action(async function (fileArg: string) {
    const opts = this.optsWithGlobals() as GlobalOpts & {
      bump?: string;
      comment?: string;
    };

    const configFile = await readConfigFile();
    const apiUrl =
      opts.apiUrl ?? resolveConfigValue('api_url', configFile).value;
    const version = await getVersion();

    const client = createHttpClient({
      apiUrl,
      verbose: opts.verbose ?? false,
      version,
    });

    const { projectId, projectSlug, envSlug } =
      await requireProjectAndEnv(opts, configFile, client);

    // Read input from file or stdin
    const raw = await readInput(fileArg);

    // Parse JSON
    let newConfig: unknown;
    try {
      newConfig = JSON.parse(raw) as unknown;
    } catch (err) {
      throw new CliError(
        `Invalid JSON: ${(err as SyntaxError).message}`,
      );
    }

    // Fetch current latest config (404 = no previous version)
    let current: ProjectConfigResponse | null;
    try {
      const res = await withSpinner('Fetching current config...', () =>
        client.get<ProjectConfigResponse>(
          `/project/${projectId}/config/${envSlug}/latest`,
        ),
      );
      current = res.data;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        current = null;
      } else {
        throw err;
      }
    }

    // Determine bump type
    let bump: BumpType;
    if (opts.bump) {
      if (
        opts.bump !== 'major' &&
        opts.bump !== 'minor' &&
        opts.bump !== 'patch'
      ) {
        throw new CliError(
          `Invalid bump type: ${opts.bump}. Use major, minor, or patch`,
        );
      }
      bump = opts.bump as BumpType;
    } else if (current === null) {
      // First push: default to minor (0.0.0 -> 0.1.0)
      bump = 'minor';
    } else {
      // Auto-detect from structural diff
      const currentConfig = JSON.parse(current.state) as unknown;
      bump = detectBump(currentConfig, newConfig);
    }

    // Compute next version
    const base = current
      ? { major: current.major, minor: current.minor, patch: current.patch }
      : { major: 0, minor: 0, patch: 0 };
    const next = computeNextVersion(base, bump);
    const newVersionStr = `${next.major}.${next.minor}.${next.patch}`;
    const oldVersionStr = current
      ? `${current.major}.${current.minor}.${current.patch}`
      : '(new)';

    // POST to API
    const { data } = await withSpinner('Pushing config...', () =>
      client.post<{ projectConfigId: string }>(
        `/project/${projectId}/config/${envSlug}`,
        {
          Major: next.major,
          Minor: next.minor,
          Patch: next.patch,
          State: JSON.stringify(newConfig),
          Comment: opts.comment ?? null,
        },
      ),
    );

    if (opts.quiet) return;

    // Success message to stderr (Phase 17 convention)
    process.stderr.write(
      `Pushed config to ${projectSlug}/${envSlug}\n  ${oldVersionStr} -> ${newVersionStr} (${bump})\n`,
    );

    // JSON output to stdout
    const format = detectFormat(opts.format as OutputFormat | undefined);
    if (format === 'json') {
      process.stdout.write(
        JSON.stringify(
          {
            projectConfigId: data.projectConfigId,
            version: newVersionStr,
            bump,
          },
          null,
          2,
        ) + '\n',
      );
    }
  });

function resolveEditor(): string {
  return process.env.EDITOR || process.env.VISUAL || 'vi';
}

configCommand
  .command('edit')
  .description('Edit config in $EDITOR and push on save')
  .option('--bump <type>', 'Version bump type (major|minor|patch)')
  .option('--comment <message>', 'Comment for this version')
  .action(async function () {
    if (!process.stdin.isTTY) {
      throw new CliError('config edit requires an interactive terminal');
    }

    const opts = this.optsWithGlobals() as GlobalOpts & {
      bump?: string;
      comment?: string;
    };

    const configFile = await readConfigFile();
    const apiUrl =
      opts.apiUrl ?? resolveConfigValue('api_url', configFile).value;
    const version = await getVersion();

    const client = createHttpClient({
      apiUrl,
      verbose: opts.verbose ?? false,
      version,
    });

    const { projectId, projectSlug, envSlug } =
      await requireProjectAndEnv(opts, configFile, client);

    // Fetch current latest config
    let current: ProjectConfigResponse;
    try {
      const res = await withSpinner('Fetching config...', () =>
        client.get<ProjectConfigResponse>(
          `/project/${projectId}/config/${envSlug}/latest`,
        ),
      );
      current = res.data;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        throw new CliError(
          'No config exists for this environment. Push config first: skystate config push <file>',
        );
      }
      throw err;
    }

    const currentConfig = JSON.parse(current.state) as unknown;

    // Create temp file
    const tempDir = mkdtempSync(join(tmpdir(), 'skystate-'));
    const tempPath = join(tempDir, `${envSlug}-config.json`);
    writeFileSync(tempPath, JSON.stringify(currentConfig, null, 2) + '\n', 'utf8');

    try {
      const editor = resolveEditor();
      let editDone = false;

      while (!editDone) {
        // Launch editor with full terminal pass-through
        const result = spawnSync(editor, [tempPath], { stdio: 'inherit' });

        if (result.status !== 0) {
          throw new CliError(
            `Editor exited with error (exit code ${result.status})`,
          );
        }

        // Read back edited file
        const edited = readFileSync(tempPath, 'utf8');

        // Parse JSON
        let newConfig: unknown;
        try {
          newConfig = JSON.parse(edited) as unknown;
        } catch (parseErr) {
          // Invalid JSON -- offer to re-open
          process.stderr.write(
            `Invalid JSON: ${(parseErr as SyntaxError).message}\n`,
          );
          const confirmed = await confirmYesNo('Edit again?');
          if (confirmed) {
            continue;
          }
          process.stderr.write('Edit cancelled.\n');
          return;
        }

        // Check for changes by comparing parsed JSON
        if (JSON.stringify(newConfig) === JSON.stringify(currentConfig)) {
          process.stderr.write('No changes made. Nothing pushed.\n');
          return;
        }

        // Determine bump type
        let bump: BumpType;
        if (opts.bump) {
          if (
            opts.bump !== 'major' &&
            opts.bump !== 'minor' &&
            opts.bump !== 'patch'
          ) {
            throw new CliError(
              `Invalid bump type: ${opts.bump}. Use major, minor, or patch`,
            );
          }
          bump = opts.bump as BumpType;
        } else {
          bump = detectBump(currentConfig, newConfig);
        }

        // Compute next version
        const base = {
          major: current.major,
          minor: current.minor,
          patch: current.patch,
        };
        const next = computeNextVersion(base, bump);
        const newVersionStr = `${next.major}.${next.minor}.${next.patch}`;
        const oldVersionStr = `${current.major}.${current.minor}.${current.patch}`;

        // POST to API
        const { data } = await withSpinner('Pushing config...', () =>
          client.post<{ projectConfigId: string }>(
            `/project/${projectId}/config/${envSlug}`,
            {
              Major: next.major,
              Minor: next.minor,
              Patch: next.patch,
              State: JSON.stringify(newConfig),
              Comment: opts.comment ?? null,
            },
          ),
        );

        if (!opts.quiet) {
          process.stderr.write(
            `Pushed config to ${projectSlug}/${envSlug}\n  ${oldVersionStr} -> ${newVersionStr} (${bump})\n`,
          );

          const format = detectFormat(opts.format as OutputFormat | undefined);
          if (format === 'json') {
            process.stdout.write(
              JSON.stringify(
                {
                  projectConfigId: data.projectConfigId,
                  version: newVersionStr,
                  bump,
                },
                null,
                2,
              ) + '\n',
            );
          }
        }

        editDone = true;
      }
    } finally {
      // Clean up temp file and directory
      try {
        unlinkSync(tempPath);
      } catch {
        // ignore
      }
      try {
        rmdirSync(tempDir);
      } catch {
        // ignore
      }
    }
  });

function formatVersionLabel(
  envSlug: string,
  s: ProjectConfigResponse,
): string {
  return `${envSlug} v${s.major}.${s.minor}.${s.patch}  ${s.createdAt}`;
}

function printDiffLines(lines: string[]): void {
  const colorize = process.stdout.isTTY;
  for (const line of lines) {
    if (colorize) {
      if (line.startsWith('---') || line.startsWith('+++')) {
        process.stdout.write(bold(line) + '\n');
      } else if (line.startsWith('@@')) {
        process.stdout.write(cyan(line) + '\n');
      } else if (line.startsWith('-')) {
        process.stdout.write(red(line) + '\n');
      } else if (line.startsWith('+')) {
        process.stdout.write(green(line) + '\n');
      } else {
        process.stdout.write(line + '\n');
      }
    } else {
      process.stdout.write(line + '\n');
    }
  }
}

configCommand
  .command('diff')
  .description('Show changes between config versions')
  .option('--env-compare <slug>', 'Compare with another environment')
  .option('--version <version>', 'Source version to diff from')
  .option('--against <version>', 'Version to diff against')
  .action(async function () {
    const opts = this.optsWithGlobals() as GlobalOpts & {
      envCompare?: string;
      version?: string;
      against?: string;
    };

    const configFile = await readConfigFile();
    const apiUrl =
      opts.apiUrl ?? resolveConfigValue('api_url', configFile).value;
    const version = await getVersion();

    const client = createHttpClient({
      apiUrl,
      verbose: opts.verbose ?? false,
      version,
    });

    const { projectId, envSlug } =
      await requireProjectAndEnv(opts, configFile, client);

    let oldJson: string;
    let newJson: string;
    let oldLabel: string;
    let newLabel: string;

    if (opts.envCompare) {
      // Cross-environment comparison
      // Validate the compare env slug locally
      resolveEnvironment(opts.envCompare);

      // Fetch latest for both environments
      let currentConfig: ProjectConfigResponse;
      let compareConfig: ProjectConfigResponse;

      try {
        const res = await withSpinner(
          `Fetching ${envSlug} config...`,
          () =>
            client.get<ProjectConfigResponse>(
              `/project/${projectId}/config/${envSlug}/latest`,
            ),
        );
        currentConfig = res.data;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          throw new CliError(`No config in environment: ${envSlug}`);
        }
        throw err;
      }

      try {
        const res = await withSpinner(
          `Fetching ${opts.envCompare} config...`,
          () =>
            client.get<ProjectConfigResponse>(
              `/project/${projectId}/config/${opts.envCompare}/latest`,
            ),
        );
        compareConfig = res.data;
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          throw new CliError(
            `No config in environment: ${opts.envCompare}`,
          );
        }
        throw err;
      }

      oldJson = JSON.stringify(
        JSON.parse(compareConfig.state) as unknown,
        null,
        2,
      );
      newJson = JSON.stringify(
        JSON.parse(currentConfig.state) as unknown,
        null,
        2,
      );
      oldLabel = formatVersionLabel(opts.envCompare, compareConfig);
      newLabel = formatVersionLabel(envSlug, currentConfig);
    } else if (opts.version || opts.against) {
      // Specific version comparison
      const { data: history } = await withSpinner(
        'Fetching version history...',
        () =>
          client.get<ProjectConfigResponse[]>(
            `/project/${projectId}/config/${envSlug}`,
          ),
      );

      if (history.length === 0) {
        throw new CliError('No config exists for this environment');
      }

      function findVersion(
        vStr: string,
        hist: ProjectConfigResponse[],
      ): ProjectConfigResponse {
        const parts = vStr.split('.');
        if (parts.length !== 3) {
          throw new CliError(
            `Invalid version format: ${vStr}. Use major.minor.patch (e.g., 1.2.3)`,
          );
        }
        const [maj, min, pat] = parts.map(Number);
        const found = hist.find(
          (s) => s.major === maj && s.minor === min && s.patch === pat,
        );
        if (!found) {
          throw new CliError(
            `Version ${vStr} not found. Run: skystate config history`,
          );
        }
        return found;
      }

      if (opts.version && opts.against) {
        // Diff --against (old) vs --version (new)
        const oldConfig = findVersion(opts.against, history);
        const newConfig = findVersion(opts.version, history);

        oldJson = JSON.stringify(
          JSON.parse(oldConfig.state) as unknown,
          null,
          2,
        );
        newJson = JSON.stringify(
          JSON.parse(newConfig.state) as unknown,
          null,
          2,
        );
        oldLabel = formatVersionLabel(envSlug, oldConfig);
        newLabel = formatVersionLabel(envSlug, newConfig);
      } else {
        // --version only: diff that version vs its predecessor
        const targetConfig = findVersion(opts.version!, history);
        const targetIdx = history.findIndex(
          (s) =>
            s.major === targetConfig.major &&
            s.minor === targetConfig.minor &&
            s.patch === targetConfig.patch,
        );

        newJson = JSON.stringify(
          JSON.parse(targetConfig.state) as unknown,
          null,
          2,
        );
        newLabel = formatVersionLabel(envSlug, targetConfig);

        if (targetIdx < history.length - 1) {
          const prevConfig = history[targetIdx + 1];
          oldJson = JSON.stringify(
            JSON.parse(prevConfig.state) as unknown,
            null,
            2,
          );
          oldLabel = formatVersionLabel(envSlug, prevConfig);
        } else {
          // First version -- show all as additions
          oldJson = '';
          oldLabel = '/dev/null';
        }
      }
    } else {
      // Default: latest vs previous
      const { data: history } = await withSpinner(
        'Fetching version history...',
        () =>
          client.get<ProjectConfigResponse[]>(
            `/project/${projectId}/config/${envSlug}`,
          ),
      );

      if (history.length === 0) {
        throw new CliError('No config exists for this environment');
      }

      const currentConfig = history[0];
      newJson = JSON.stringify(
        JSON.parse(currentConfig.state) as unknown,
        null,
        2,
      );
      newLabel = formatVersionLabel(envSlug, currentConfig);

      if (history.length > 1) {
        const prevConfig = history[1];
        oldJson = JSON.stringify(
          JSON.parse(prevConfig.state) as unknown,
          null,
          2,
        );
        oldLabel = formatVersionLabel(envSlug, prevConfig);
      } else {
        // First version -- show all as additions
        oldJson = '';
        oldLabel = '/dev/null';
      }
    }

    // Generate diff
    const { lines, stats } = generateUnifiedDiff(
      oldJson,
      newJson,
      oldLabel,
      newLabel,
    );

    if (lines.length === 0) {
      process.stderr.write('No differences\n');
      return;
    }

    // Output diff to stdout (colorized if TTY)
    printDiffLines(lines);

    // Stats to stderr per CLI_SPEC.md
    process.stderr.write(`+${stats.added} -${stats.removed}\n`);
  });

configCommand
  .command('promote')
  .argument('<target-env>', 'Target environment slug')
  .description('Promote config to another environment')
  .option('--bump <type>', 'Version bump type (major|minor|patch)')
  .option('--comment <message>', 'Override auto-generated comment')
  .option('--force', 'Skip confirmation prompt')
  .action(async function (targetEnvArg: string) {
    const opts = this.optsWithGlobals() as GlobalOpts & {
      bump?: string;
      comment?: string;
      force?: boolean;
    };

    const configFile = await readConfigFile();
    const apiUrl =
      opts.apiUrl ?? resolveConfigValue('api_url', configFile).value;
    const version = await getVersion();

    const client = createHttpClient({
      apiUrl,
      verbose: opts.verbose ?? false,
      version,
    });

    const { projectId, envSlug } =
      await requireProjectAndEnv(opts, configFile, client);

    // Check same-environment before any API calls
    if (targetEnvArg.toLowerCase() === envSlug.toLowerCase()) {
      throw new CliError('Cannot promote to same environment');
    }

    // Validate target environment slug locally
    resolveEnvironment(targetEnvArg);

    // Fetch source env's latest config
    let sourceConfig: ProjectConfigResponse;
    try {
      const res = await withSpinner(`Fetching ${envSlug} config...`, () =>
        client.get<ProjectConfigResponse>(
          `/project/${projectId}/config/${envSlug}/latest`,
        ),
      );
      sourceConfig = res.data;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        throw new CliError(`No config in source environment: ${envSlug}`);
      }
      throw err;
    }

    // Fetch target env's latest config (404 = fresh target)
    let targetLatest: ProjectConfigResponse | null;
    try {
      const res = await withSpinner(`Fetching ${targetEnvArg} config...`, () =>
        client.get<ProjectConfigResponse>(
          `/project/${projectId}/config/${targetEnvArg}/latest`,
        ),
      );
      targetLatest = res.data;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        targetLatest = null; // Fresh target
      } else {
        throw err;
      }
    }

    // Compute version for target environment
    let bump: BumpType;
    if (opts.bump) {
      if (opts.bump !== 'major' && opts.bump !== 'minor' && opts.bump !== 'patch') {
        throw new CliError(`Invalid bump type: ${opts.bump}. Use major, minor, or patch`);
      }
      bump = opts.bump as BumpType;
    } else if (targetLatest === null) {
      bump = 'minor'; // First push to target: 0.0.0 -> 0.1.0
    } else {
      const sourceConfigData = JSON.parse(sourceConfig.state) as unknown;
      const targetConfigData = JSON.parse(targetLatest.state) as unknown;
      bump = detectBump(targetConfigData, sourceConfigData);
    }

    const targetBase = targetLatest
      ? { major: targetLatest.major, minor: targetLatest.minor, patch: targetLatest.patch }
      : { major: 0, minor: 0, patch: 0 };
    const next = computeNextVersion(targetBase, bump);
    const newVersionStr = `${next.major}.${next.minor}.${next.patch}`;
    const oldVersionStr = targetLatest
      ? `${targetLatest.major}.${targetLatest.minor}.${targetLatest.patch}`
      : '(new)';
    const sourceVersionStr = `${sourceConfig.major}.${sourceConfig.minor}.${sourceConfig.patch}`;

    // Confirmation prompt
    requireInteractive(opts.force ?? false);
    if (!opts.force) {
      process.stderr.write(
        `Promote ${envSlug} v${sourceVersionStr} -> ${targetEnvArg}\n` +
        `  ${targetEnvArg}: ${oldVersionStr} -> ${newVersionStr} (${bump})\n`,
      );
      const confirmed = await confirmYesNo('Continue?');
      if (!confirmed) {
        process.stderr.write('Cancelled.\n');
        return;
      }
    }

    // POST to target env's create endpoint (same endpoint as push)
    const comment = opts.comment ?? `Promoted from ${envSlug} v${sourceVersionStr}`;
    const { data } = await withSpinner('Promoting config...', () =>
      client.post<{ projectConfigId: string }>(
        `/project/${projectId}/config/${targetEnvArg}`,
        {
          Major: next.major,
          Minor: next.minor,
          Patch: next.patch,
          State: sourceConfig.state, // Pass through raw config string (already JSON)
          Comment: comment,
        },
      ),
    );

    if (!opts.quiet) {
      process.stderr.write(
        `Promoted ${envSlug} v${sourceVersionStr} -> ${targetEnvArg}\n` +
        `  ${targetEnvArg}: ${oldVersionStr} -> ${newVersionStr} (${bump})\n`,
      );

      const format = detectFormat(opts.format as OutputFormat | undefined);
      if (format === 'json') {
        process.stdout.write(
          JSON.stringify(
            { projectConfigId: data.projectConfigId, version: newVersionStr, bump },
            null,
            2,
          ) + '\n',
        );
      }
    }
  });

configCommand
  .command('rollback')
  .argument('<version>', 'Version to roll back to (e.g., 1.2.0)')
  .description('Roll back to a historical version')
  .option('--force', 'Skip confirmation prompt')
  .action(async function (versionArg: string) {
    const opts = this.optsWithGlobals() as GlobalOpts & {
      force?: boolean;
    };

    const configFile = await readConfigFile();
    const apiUrl =
      opts.apiUrl ?? resolveConfigValue('api_url', configFile).value;
    const version = await getVersion();

    const client = createHttpClient({
      apiUrl,
      verbose: opts.verbose ?? false,
      version,
    });

    const { projectId, envSlug } =
      await requireProjectAndEnv(opts, configFile, client);

    // Parse version argument
    const parts = versionArg.split('.');
    if (parts.length !== 3) {
      throw new CliError(
        `Invalid version format: ${versionArg}. Use major.minor.patch (e.g., 1.2.0)`,
      );
    }
    const [targetMajor, targetMinor, targetPatch] = parts.map(Number);
    if (parts.some((p) => isNaN(Number(p)))) {
      throw new CliError(
        `Invalid version format: ${versionArg}. Use major.minor.patch (e.g., 1.2.0)`,
      );
    }

    // Fetch history to find the target version's UUID
    const { data: history } = await withSpinner('Fetching version history...', () =>
      client.get<ProjectConfigResponse[]>(
        `/project/${projectId}/config/${envSlug}`,
      ),
    );

    if (history.length === 0) {
      throw new CliError('No config exists for this environment');
    }

    const targetVersion = history.find(
      (s) => s.major === targetMajor && s.minor === targetMinor && s.patch === targetPatch,
    );
    if (!targetVersion) {
      throw new CliError(
        `Version ${versionArg} not found. Run: skystate config history`,
      );
    }

    // Confirmation prompt
    requireInteractive(opts.force ?? false);
    if (!opts.force) {
      process.stderr.write(
        `Roll back ${envSlug} to v${versionArg}?\n` +
        `This will create a new version with the content of v${versionArg}.\n`,
      );
      const confirmed = await confirmYesNo('Confirm?');
      if (!confirmed) {
        process.stderr.write('Cancelled.\n');
        return;
      }
    }

    // POST to rollback API endpoint
    const { data } = await withSpinner('Rolling back...', () =>
      client.post<{ projectConfigId: string }>(
        `/project/${projectId}/config/${envSlug}/rollback/${targetVersion.projectStateId}`,
        {},
      ),
    );

    if (!opts.quiet) {
      process.stderr.write(
        `Rolled back ${envSlug} to v${versionArg}\n` +
        `  New version created\n`,
      );

      const format = detectFormat(opts.format as OutputFormat | undefined);
      if (format === 'json') {
        process.stdout.write(
          JSON.stringify(
            { projectConfigId: data.projectConfigId, rolledBackTo: versionArg },
            null,
            2,
          ) + '\n',
        );
      }
    }
  });

configCommand
  .command('fetch')
  .argument('<project-slug>', 'Project slug')
  .argument('<env-slug>', 'Environment slug')
  .description('Fetch public config (no auth required)')
  .action(async function (projectSlug: string, envSlug: string) {
    const opts = this.optsWithGlobals() as GlobalOpts;

    const configFile = await readConfigFile();
    const apiUrl =
      opts.apiUrl ?? resolveConfigValue('api_url', configFile).value;
    const version = await getVersion();

    const client = createHttpClient({
      apiUrl,
      verbose: opts.verbose ?? false,
      version,
    });

    const path = `/project/${encodeURIComponent(projectSlug)}/config/${encodeURIComponent(envSlug)}`;

    let data: PublicConfigResponse;
    try {
      const res = await withSpinner('Fetching public config...', () =>
        client.get<PublicConfigResponse>(path, { auth: false }),
      );
      data = res.data;
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          throw new CliError('Project or environment not found');
        }
        if (err.status === 400) {
          throw new CliError('Invalid slug format');
        }
      }
      throw err;
    }

    if (opts.quiet) return;

    const format = detectFormat(opts.format as OutputFormat | undefined);

    if (format === 'json' && opts.format === 'json') {
      // Explicit --format json: output full API response envelope pretty-printed
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
    } else {
      // Default / plain / table: output raw config payload only
      process.stdout.write(JSON.stringify(data.config) + '\n');
    }
  });
