import chalk from 'chalk';
import * as p from '@clack/prompts';
import { exec } from 'child_process';
import { UserProfile } from '../../types/index.js';
import { saveUserProfile } from '../../core/storage.js';
import { validateApiKey, ProviderType, POPULAR_MODELS } from '../../core/liveClient.js';
import { scanDetectedCliSessions, startGoogleOAuthServer } from '../../core/cliAuth.js';

export async function runAuthSetup(profile: UserProfile): Promise<boolean> {
  console.clear();
  console.log('\n  ' + chalk.hex('#F8FAFC').bold('[AUTHENTICATION & CLI HARNESS CONNECT]'));
  console.log(chalk.hex('#64748B')('  Connect Antigravity CLI, Gemini, Codex, Claude, or custom API credentials.\n'));

  const detected = scanDetectedCliSessions();
  const options: Array<{ value: string; label: string; hint?: string }> = [];

  // Add detected CLI harnesses
  for (const session of detected) {
    const isCurrent = profile.apiProvider === session.provider;
    options.push({
      value: `cli_${session.provider}_${session.harness}`,
      label: `${chalk.hex('#10B981')('●')} Use Local ${session.name} ${chalk.hex('#94A3B8')(`(${session.email})`)}`,
      hint: `Default model: ${session.defaultModel} · No key entry required`,
    });
  }

  // Add browser OAuth flow option (OpenCode style)
  options.push({
    value: 'google_oauth_browser',
    label: '→ Browser OAuth Login (Google / Gemini CLI flow)',
    hint: 'Opens browser to sign in via Google and capture CLI tokens',
  });

  // Add manual API key configuration
  options.push({
    value: 'manual_api_key',
    label: '→ Enter Custom API Key (Gemini / OpenAI / Anthropic)',
    hint: 'Input standard developer API key for direct REST completion',
  });

  options.push({
    value: 'cancel',
    label: 'Back to Chatbox',
  });

  const selected = await p.select({
    message: 'Select Authentication Method:',
    options,
  });

  if (p.isCancel(selected) || selected === 'cancel') {
    return false;
  }

  // Handling detected local CLI selection
  if (typeof selected === 'string' && selected.startsWith('cli_')) {
    const parts = selected.split('_');
    const provider = parts[1] as ProviderType;
    const session = detected.find((s) => s.provider === provider);

    profile.apiProvider = provider;
    profile.activeModel = session?.defaultModel || POPULAR_MODELS[provider][0].id;
    await saveUserProfile(profile);

    p.outro(
      chalk.hex('#10B981')(
        `✓ Connected to ${session?.name || provider.toUpperCase()} (${session?.email || 'Authenticated'})\n  Active Model: ${profile.activeModel}`
      )
    );
    return true;
  }

  // Handling Google OAuth browser flow
  if (selected === 'google_oauth_browser') {
    const spinner = p.spinner();
    spinner.start('Starting local OAuth callback listener on port 51121...');

    try {
      const { authUrl, waitForCredentials } = await startGoogleOAuthServer();
      spinner.stop(chalk.hex('#38BDF8')('✦ Local callback server listening.'));

      console.log('\n  ' + chalk.hex('#F8FAFC')('Open the following link in your browser to sign in:'));
      console.log('  ' + chalk.hex('#38BDF8').underline(authUrl) + '\n');

      // Attempt to open browser automatically on macOS
      if (process.platform === 'darwin') {
        exec(`open "${authUrl}"`);
      }

      spinner.start('Waiting for Google authorization callback in browser...');
      const creds = await waitForCredentials();
      spinner.stop(chalk.hex('#10B981')(`✓ Google credentials captured for ${creds.email}!`));

      profile.apiProvider = 'gemini';
      profile.activeModel = 'gemini-2.0-flash';
      await saveUserProfile(profile);

      p.outro(chalk.hex('#10B981')(`Antigravity / Gemini CLI session active with ${profile.activeModel} (latest)`));
      return true;
    } catch (err: any) {
      spinner.stop(chalk.hex('#EF4444')(`OAuth flow failed: ${err.message}`));
      await p.text({ message: 'Press Enter to continue...' });
      return false;
    }
  }

  // Handling manual API key entry
  if (selected === 'manual_api_key') {
    const providerChoice = await p.select({
      message: 'Select Provider for API Key:',
      options: [
        { value: 'gemini', label: 'Google Gemini (aistudio.google.com)', hint: 'Free tier available' },
        { value: 'openai', label: 'OpenAI (platform.openai.com)' },
        { value: 'anthropic', label: 'Anthropic Claude (console.anthropic.com)' },
        { value: 'cancel', label: 'Cancel' },
      ],
    });

    if (p.isCancel(providerChoice) || providerChoice === 'cancel') return false;
    const provider = providerChoice as ProviderType;

    const keyInput = await p.text({
      message: `Enter your ${provider.toUpperCase()} API Key:`,
      placeholder: provider === 'gemini' ? 'AIzaSy...' : provider === 'openai' ? 'sk-proj-...' : 'sk-ant-...',
      validate: (val) => {
        if (!val || !val.trim()) return 'API key cannot be empty.';
      },
    });

    if (p.isCancel(keyInput) || !keyInput) return false;

    const key = (keyInput as string).trim();
    const spinner = p.spinner();
    spinner.start(`Validating credentials against ${provider.toUpperCase()} API...`);

    const result = await validateApiKey(provider, key);
    if (!result.valid) {
      spinner.stop(chalk.hex('#EF4444')(`Validation failed: ${result.error}`));
      await p.text({ message: 'Press Enter to continue...' });
      return false;
    }

    spinner.stop(chalk.hex('#10B981')(`✓ Validated successfully against ${provider.toUpperCase()} endpoint!`));

    if (!profile.apiKeys) profile.apiKeys = {};
    profile.apiKeys[provider] = key;
    profile.apiProvider = provider;
    profile.activeModel = POPULAR_MODELS[provider][0].id;
    await saveUserProfile(profile);

    p.outro(chalk.hex('#10B981')(`Active model set to: ${profile.activeModel} (latest)`));
    return true;
  }

  return false;
}

export async function runModelPicker(profile: UserProfile): Promise<void> {
  const currentProvider = profile.apiProvider || 'gemini';
  const models = POPULAR_MODELS[currentProvider] || POPULAR_MODELS.gemini;

  const options = models.map((m) => ({
    value: m.id,
    label: `${m.id === profile.activeModel ? '● ' : '○ '}${m.name}`,
    hint: m.description,
  }));

  const selected = await p.select({
    message: `Select Model for [${currentProvider.toUpperCase()}]:`,
    options: [
      ...options,
      { value: 'switch_harness', label: '→ Switch Harness / CLI Session' },
      { value: 'cancel', label: 'Cancel' },
    ],
  });

  if (p.isCancel(selected) || selected === 'cancel') return;

  if (selected === 'switch_harness') {
    await runAuthSetup(profile);
  } else {
    profile.activeModel = selected as string;
    await saveUserProfile(profile);
    p.outro(chalk.hex('#10B981')(`Switched active model to: ${profile.activeModel}`));
  }
}
