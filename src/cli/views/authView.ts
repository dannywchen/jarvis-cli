import chalk from 'chalk';
import * as p from '@clack/prompts';
import { UserProfile } from '../../types/index.js';
import { saveUserProfile } from '../../core/storage.js';
import { validateApiKey, sendLiveLlmPrompt, normalizeModelId, ProviderType, POPULAR_MODELS } from '../../core/liveClient.js';
import { getAntigravityCliPath, runAntigravityCliLogin, scanDetectedCliSessions } from '../../core/cliAuth.js';

export async function runAuthSetup(profile: UserProfile): Promise<boolean> {
  console.clear();
  console.log('\n  ' + chalk.hex('#F8FAFC').bold('[AUTHENTICATION & CLI HARNESS CONNECT]'));
  console.log(chalk.hex('#64748B')('  Connect Antigravity CLI, Gemini, Codex, Claude, or custom API credentials.\n'));

  const detected = scanDetectedCliSessions();
  const options: Array<{ value: string; label: string; hint?: string }> = [];

  // Add detected CLI harnesses
  for (const session of detected.filter((item) => item.hasValidSession)) {
    options.push({
      value: `cli:${session.harness}`,
      label: `${chalk.hex('#10B981')('●')} Use Local ${session.name} ${chalk.hex('#94A3B8')(`(${session.email})`)}`,
      hint: `Default model: ${session.defaultModel}${session.harness === 'codex-cli' ? ' · reasoning: high' : ''} · No key entry required`,
    });
  }

  if (getAntigravityCliPath() !== 'agy') {
    options.push({
      value: 'antigravity_cli_login',
      label: '→ Reconnect with official Antigravity CLI',
      hint: 'Opens the supported Antigravity login flow; run /auth there if needed',
    });
  }

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
  if (typeof selected === 'string' && selected.startsWith('cli:')) {
    const harness = selected.slice('cli:'.length);
    const session = detected.find((item) => item.harness === harness && item.hasValidSession);
    if (!session) {
      p.outro(chalk.hex('#EF4444')('That local session is no longer available. Run /auth and choose another method.'));
      return false;
    }
    const provider = session.provider as ProviderType;

    profile.apiProvider = provider;
    profile.activeModel = session.defaultModel || POPULAR_MODELS[provider][0].id;
    await saveUserProfile(profile);

    p.outro(
      chalk.hex('#10B981')(
        `✓ Connected to ${session.name} (${session.email || 'Authenticated'})\n  Active Model: ${profile.activeModel}\n  Run /model at any time to choose a different model.`
      )
    );
    return true;
  }

  if (selected === 'antigravity_cli_login') {
    console.log('\n  Antigravity CLI is starting. Run /auth in that session if Google asks you to reconnect, then exit it to return here.\n');
    const result = await runAntigravityCliLogin();
    if (!result.success) {
      p.outro(chalk.hex('#EF4444')(result.error || 'Antigravity CLI authentication did not complete.'));
      return false;
    }

    const verification = await sendLiveLlmPrompt({
      provider: 'gemini',
      model: 'gemini-3.8-flash',
      harness: 'antigravity-cli',
      prompt: 'Reply with exactly OK',
    });
    if (verification.error) {
      p.outro(chalk.hex('#EF4444')(`Antigravity reconnect did not verify: ${verification.error}`));
      return false;
    }

    profile.apiProvider = 'gemini';
    profile.activeModel = 'gemini-3.8-flash';
    await saveUserProfile(profile);
    p.outro(chalk.hex('#10B981')('✓ Antigravity CLI session verified and connected.'));
    return true;
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
  const currentModel = normalizeModelId(currentProvider, profile.activeModel);

  const options = models.map((m) => ({
    value: m.id,
    label: `${m.id === currentModel ? '● ' : '○ '}${m.name}`,
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
