// Which OS's setup commands to show. The browser's OS is only a guess for the laptop that runs
// `npm run control` (you can open the hosted dashboard from another computer), so the Control tab
// lets you switch and remembers the choice.

export type OS = 'mac' | 'linux' | 'windows';
export const OS_LABEL: Record<OS, string> = { mac: 'macOS', linux: 'Linux', windows: 'Windows' };

/** Best guess from the browser. Mac is checked first: some strings say "Darwin", which contains "win". */
export function detectOS(): OS {
  if (typeof navigator === 'undefined') return 'mac';
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const s = `${nav.userAgentData?.platform ?? ''} ${nav.platform ?? ''} ${nav.userAgent ?? ''}`.toLowerCase();
  if (/mac|iphone|ipad|darwin/.test(s)) return 'mac';
  if (/win/.test(s)) return 'windows';
  return 'linux';
}

const KEY = 'insync.os';
export function savedOS(): OS {
  try { const v = localStorage.getItem(KEY); if (v === 'mac' || v === 'linux' || v === 'windows') return v; } catch { /* private window */ }
  return detectOS();
}
export function saveOS(os: OS) { try { localStorage.setItem(KEY, os); } catch { /* private window */ } }

/** Commands to start the daemon, one per line with no `&&` or `#` comments, so they paste into any
 *  shell (Windows PowerShell 5.1 rejects `&&`; cmd passes `#` to the command). `npm run control`
 *  only exists on current main, so an old branch fails with "Missing script: control". */
export function controlSteps(os: OS): string {
  return [
    os === 'windows' ? 'cd C:\\path\\to\\contract' : 'cd ~/path/to/contract',
    'git checkout main',
    'git pull',
    'npm install',
    'npm run control',
  ].join('\n');
}

/** The first-run copy of .env.example: `copy` works in both cmd and PowerShell; `cp` everywhere else. */
export const envCopy = (os: OS) => (os === 'windows' ? 'copy .env.example .env' : 'cp .env.example .env');

/** Where to type the commands, in words a first-timer recognizes. */
export const terminalName = (os: OS) => (os === 'windows' ? 'PowerShell or Command Prompt' : 'Terminal');
