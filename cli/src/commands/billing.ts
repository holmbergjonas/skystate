import { Command } from '@commander-js/extra-typings';
import { CliError } from '../lib/errors.js';

const notImplemented = () => {
  throw new CliError('Not yet implemented. Coming soon.');
};

export const billingCommand = new Command('billing')
  .description('Manage billing and subscriptions');

billingCommand
  .command('status')
  .description('Show current plan and billing info')
  .action(notImplemented);

billingCommand
  .command('plans')
  .description('List available plans and pricing')
  .action(notImplemented);

billingCommand
  .command('upgrade')
  .argument('<tier>', 'Target tier (hobby, pro)')
  .description('Upgrade your plan')
  .action(notImplemented);

billingCommand
  .command('boost')
  .description('Purchase or update Pro Boost add-on')
  .action(notImplemented);

billingCommand
  .command('portal')
  .description('Open Stripe customer portal')
  .action(notImplemented);

billingCommand
  .command('invoices')
  .description('List billing invoices')
  .action(notImplemented);

/** Standalone usage command — registered at the top level under Billing group. */
export const usageCommand = new Command('usage')
  .description('Show current resource usage across all meters')
  .action(notImplemented);
