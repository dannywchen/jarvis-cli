import { UserProfile } from '../../types/index.js';
import { runAuthSetup } from './authView.js';

export async function runConnectMenu(profile: UserProfile): Promise<void> {
  await runAuthSetup(profile);
}
