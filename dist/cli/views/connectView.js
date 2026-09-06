import { runAuthSetup } from './authView.js';
export async function runConnectMenu(profile) {
    await runAuthSetup(profile);
}
