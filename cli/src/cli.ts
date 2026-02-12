#!/usr/bin/env node

import { Command } from '@commander-js/extra-typings';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CliError } from './lib/errors.js';
import { colors } from './lib/colors.js';
import { registerCommands } from './commands/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));

const program = new Command()
  .name('skystate')
  .description('Manage durable, versioned state from the terminal')
  .version(pkg.version, '-v, --version')
  .option('--format <format>', 'Output format (table, json, plain)')
  .option('--quiet', 'Suppress informational output')
  .option('--verbose', 'Show HTTP debug info on stderr')
  .option('--api-url <url>', 'Override API base URL')
  .option('--project <slug>', 'Override default project')
  .option('--env <slug>', 'Override default environment');

registerCommands(program);

program.addHelpText('after', `
Examples:
  $ skystate login                      Log in via GitHub
  $ skystate projects list              List all projects
  $ skystate state get | jq '.theme'    Get a value from state
  $ skystate state push config.json     Push new state from file
  $ skystate state diff                 View changes since last version
`);

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    const useColor = process.stderr.isTTY && !process.env.NO_COLOR;
    if (err instanceof CliError) {
      const prefix = useColor ? colors.error('Error:') : 'Error:';
      process.stderr.write(`${prefix} ${err.message}\n`);
      if (err.hint) {
        const hint = useColor ? colors.hint(err.hint) : err.hint;
        process.stderr.write(`${hint}\n`);
      }
      process.exitCode = err.exitCode;
    } else {
      const prefix = useColor ? colors.error('Error:') : 'Error:';
      process.stderr.write(
        `${prefix} ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exitCode = 1;
    }
  }
}

main();
