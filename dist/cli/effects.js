import chalk from 'chalk';
export async function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export function playChime() {
    try {
        process.stdout.write('\x07');
    }
    catch {
        // ignore
    }
}
export async function showConfetti() {
    playChime();
    const particles = ['·', '+', '*', '■', '░', '▪'];
    const colors = [
        chalk.hex('#CBD5E1'),
        chalk.hex('#94A3B8'),
        chalk.hex('#64748B'),
        chalk.hex('#38BDF8'),
    ];
    console.log('');
    for (let row = 0; row < 2; row++) {
        let line = '  ';
        for (let col = 0; col < 26; col++) {
            if (Math.random() > 0.5) {
                const char = particles[Math.floor(Math.random() * particles.length)];
                const color = colors[Math.floor(Math.random() * colors.length)];
                line += color(char) + ' ';
            }
            else {
                line += '  ';
            }
        }
        console.log(line);
        await sleep(40);
    }
    console.log('');
}
export function renderCombo(combo) {
    if (combo <= 1)
        return;
    if (combo === 2) {
        console.log(chalk.hex('#38BDF8')(`  [COMBO x2] +20% XP Bonus`));
    }
    else if (combo === 3) {
        console.log(chalk.hex('#F59E0B')(`  [COMBO x3] STREAK ACTIVE · +50% XP Bonus`));
    }
    else if (combo >= 4) {
        console.log(chalk.hex('#F8FAFC').bold(`  [COMBO x${combo}] UNSTOPPABLE · +100% XP Bonus`));
    }
}
export function renderLevelUp(newLevel) {
    playChime();
    console.log(chalk.hex('#F8FAFC').bold(`
  ┌──────────────────────────────────────────────┐
  │             [ LEVEL ASCENSION ]              │
  │             Advanced to Level ${String(newLevel).padEnd(2)}             │
  └──────────────────────────────────────────────┘
    `));
}
