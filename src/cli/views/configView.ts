import chalk from 'chalk';
import * as p from '@clack/prompts';
import { UserProfile, Pace } from '../../types/index.js';
import { saveUserProfile } from '../../core/storage.js';

export async function runConfigMenu(profile: UserProfile): Promise<void> {
  console.clear();
  console.log('\n  ' + chalk.hex('#F8FAFC').bold('[CONFIG] SETTINGS & MODES'));

  const option = await p.select({
    message: 'Configuration Parameter:',
    options: [
      {
        value: 'zen',
        label: `Zen Mode (${profile.zenMode ? chalk.hex('#38BDF8')('ENABLED · Infinite HP') : chalk.hex('#64748B')('DISABLED · Standard 5 HP')})`,
      },
      {
        value: 'name',
        label: `Learner Handle (Current: ${chalk.white(profile.name)})`,
      },
      {
        value: 'apikey',
        label: `AI Engine Provider (Current: ${profile.apiProvider || chalk.hex('#64748B')('Autonomous Heuristic Engine')})`,
      },
      {
        value: 'back',
        label: 'Return to Hub',
      },
    ],
  });

  if (p.isCancel(option) || option === 'back') {
    return;
  }

  if (option === 'zen') {
    profile.zenMode = !profile.zenMode;
    await saveUserProfile(profile);
    p.outro(chalk.hex('#10B981')(`Zen Mode: ${profile.zenMode ? 'ENABLED (Infinite HP)' : 'DISABLED (Standard 5 HP)'}`));
  } else if (option === 'name') {
    const newName = await p.text({
      message: 'Enter learner handle:',
      defaultValue: profile.name,
    });
    if (!p.isCancel(newName) && typeof newName === 'string') {
      profile.name = newName.trim();
      await saveUserProfile(profile);
      p.outro(chalk.hex('#10B981')(`Handle updated: ${profile.name}`));
    }
  } else if (option === 'apikey') {
    const provider = await p.select({
      message: 'AI Provider Engine:',
      options: [
        { value: 'gemini', label: 'Google Gemini (Fast & Recommended)' },
        { value: 'anthropic', label: 'Anthropic Claude' },
        { value: 'openai', label: 'OpenAI GPT-4o' },
        { value: 'none', label: 'None (Autonomous Heuristic Engine)' },
      ],
    });

    if (!p.isCancel(provider)) {
      if (provider === 'none') {
        profile.apiProvider = undefined;
        profile.apiKey = undefined;
        await saveUserProfile(profile);
        p.outro(chalk.hex('#10B981')('Switched to autonomous zero-dependency engine.'));
      } else {
        const key = await p.text({
          message: `${provider} API Key:`,
          placeholder: 'sk-... or AIzaSy...',
        });
        if (!p.isCancel(key) && typeof key === 'string' && key.trim()) {
          profile.apiProvider = provider as any;
          profile.apiKey = key.trim();
          await saveUserProfile(profile);
          p.outro(chalk.hex('#10B981')(`Configured ${provider} provider.`));
        }
      }
    }
  }
}
