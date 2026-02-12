import { Command } from '@commander-js/extra-typings';
import {
  validateKey,
  validateValue,
  writeConfig,
  readConfigFile,
  resolveConfigValue,
  listConfigValues,
  getConfigPath,
} from '../lib/config.js';
import { output, type OutputFormat } from '../lib/output.js';

export const settingsCommand = new Command('settings')
  .description('Manage CLI settings');

settingsCommand
  .command('set')
  .argument('<key>', 'Settings key')
  .argument('<value>', 'Settings value')
  .description('Set a settings value')
  .action(async (key: string, value: string) => {
    validateKey(key);
    validateValue(key, value);
    await writeConfig(key, value);
    process.stdout.write(`Set ${key} = ${value}\n`);
  });

settingsCommand
  .command('get')
  .argument('<key>', 'Settings key')
  .description('Get a settings value')
  .action(async (key: string) => {
    validateKey(key);
    const configFile = await readConfigFile();
    const resolved = resolveConfigValue(key, configFile);
    if (resolved.value === '') {
      // Key not set with empty default: empty stdout, exit 0
      process.stdout.write('');
    } else {
      process.stdout.write(resolved.value + '\n');
    }
  });

settingsCommand
  .command('list')
  .description('Show all settings')
  .action(async () => {
    const globalOpts = settingsCommand.optsWithGlobals() as unknown as { format?: string; quiet?: boolean };
    const values = await listConfigValues();

    const jsonData: Record<string, string> = {};
    for (const v of values) {
      jsonData[v.key] = v.value;
    }

    output(
      jsonData,
      {
        headers: ['KEY', 'VALUE', 'SOURCE'],
        rows: values.map((v) => [v.key, v.value, v.source]),
      },
      {
        format: globalOpts.format as OutputFormat | undefined,
        quiet: globalOpts.quiet,
      },
    );
  });

settingsCommand
  .command('path')
  .description('Print the settings file path')
  .action(() => {
    process.stdout.write(getConfigPath() + '\n');
  });
