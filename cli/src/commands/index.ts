import type { Command } from '@commander-js/extra-typings';
import { loginCommand, logoutCommand, statusCommand } from './auth.js';
import { projectsCommand } from './projects.js';
import { envsCommand } from './envs.js';
import { configCommand } from './config.js';
import { billingCommand, usageCommand } from './billing.js';
import { settingsCommand } from './settings.js';

/**
 * Register all command groups on the root program.
 * Groups commands by resource like gh and kubectl.
 */
export function registerCommands(program: Command): void {
  program.commandsGroup('Auth:');
  program.addCommand(loginCommand);
  program.addCommand(logoutCommand);
  program.addCommand(statusCommand);

  program.commandsGroup('Resources:');
  program.addCommand(projectsCommand);
  program.addCommand(envsCommand);

  program.commandsGroup('Config:');
  program.addCommand(configCommand);

  program.commandsGroup('Billing:');
  program.addCommand(billingCommand);
  program.addCommand(usageCommand);

  program.commandsGroup('Settings:');
  program.addCommand(settingsCommand);
}
