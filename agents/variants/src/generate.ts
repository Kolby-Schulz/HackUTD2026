// Turns a job brief into a variant folder: the prompt, the answer's schema, validation and the file text.
// Pure apart from the model call, which goes through packages/llm (decide) so tokens are logged and the
// provider can be swapped. The caller writes the files, typechecks and commits them (repo.ts).
import type { LLM, Usage } from '@contract/llm';

export interface ScreenInfo {
  id: string;
  title: string;
  /** Slot id -> label, in display order (from screen.tsx). */
  slots: Record<string, string>;
}

export interface GenerateInput {
  screen: ScreenInfo;
  /** The new folder name (the variant id inside the screen). */
  id: string;
  /** The node the variant extends (a code variant or a mix), or null for a new root that fills every slot. */
  parent: string | null;
  brief: string;
  /** Source files the parent's look comes from, as `path -> text` (index.tsx and CSS modules). */
  context: Record<string, string>;
  /** DESIGN.md, so the variant uses the project's tokens. */
  design: string;
  model?: string;
}

export interface Answer {
  title: string;
  note: string;
  slots: { slot: string; jsx: string }[];
  css: string;
}

export interface Files { 'index.tsx': string; 'styles.module.css': string }

/** The answer's JSON schema. Strict-mode friendly (fixed keys), so Nemotron's structured output accepts it. */
export function answerSchema(slotIds: string[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'note', 'slots', 'css'],
    properties: {
      title: { type: 'string', description: 'Short name for the variant, 2-5 words' },
      note: { type: 'string', description: 'One sentence: what changed and why' },
      slots: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['slot', 'jsx'],
          properties: { slot: { type: 'string', enum: slotIds }, jsx: { type: 'string', description: 'One JSX element' } },
        },
      },
      css: { type: 'string', description: 'The CSS module for the classes used as s.<name>' },
    },
  };
}

export function buildPrompt(i: GenerateInput, problem?: string): string {
  const slotList = Object.entries(i.screen.slots).map(([id, label]) => `- ${id}: ${label}`).join('\n');
  const files = Object.entries(i.context).map(([path, text]) => `--- ${path}\n${text}`).join('\n\n');
  return [
    `You design one variant of the screen "${i.screen.title}" for a design comparison tool.`,
    i.parent
      ? `It is a child of "${i.parent}": override only the slots the brief is about; the rest are inherited.`
      : 'It is a new root design: fill every slot.',
    `Brief: ${i.brief}`,
    '',
    `Slots:\n${slotList}`,
    '',
    'Answer rules:',
    '- Each slot is ONE JSX element (a tree is fine), with no surrounding code, no imports and no hooks.',
    '- Style with className={s.name} from the CSS module you return in `css`, or inline style objects.',
    '- In CSS use container queries (@container (max-width: 700px)), never media queries. No :global, no @import.',
    '- Plain markup only: no <script>, no event handlers that fetch, no dangerouslySetInnerHTML, no external URLs.',
    '- Use the design tokens below (colors, type, radius) unless the brief asks otherwise.',
    '',
    `Design system (DESIGN.md):\n${i.design}`,
    '',
    files ? `The parent's source, for reference:\n${files}` : '',
    problem ? `\nYour previous answer was rejected: ${problem}\nFix that and answer again.` : '',
  ].join('\n');
}

const BANNED: [RegExp, string][] = [
  [/\bimport\b|\brequire\s*\(/, 'imports are not allowed'],
  [/dangerouslySetInnerHTML/, 'dangerouslySetInnerHTML is not allowed'],
  [/<script\b/i, '<script> is not allowed'],
  [/\b(fetch|eval|Function|XMLHttpRequest|WebSocket|localStorage|document|window)\b\s*[.(]/, 'browser APIs are not allowed'],
  [/\b(useState|useEffect|useRef|useMemo|useCallback)\b/, 'hooks are not allowed'],
  [/(src|href)\s*=\s*["{]\s*["'`]?\s*(https?:)?\/\//, 'external URLs are not allowed'],
];

/** Problems with an answer, as one sentence for the retry prompt; empty when it is usable. */
export function validate(a: unknown, slotIds: string[], root: boolean): string {
  if (typeof a !== 'object' || a === null) return 'the answer is not a JSON object';
  const x = a as Partial<Answer>;
  if (typeof x.title !== 'string' || !x.title.trim()) return 'title is missing';
  if (typeof x.css !== 'string') return 'css is missing';
  if (!Array.isArray(x.slots) || !x.slots.length) return 'slots is empty';
  const seen = new Set<string>();
  for (const s of x.slots) {
    if (!s || typeof s.slot !== 'string' || typeof s.jsx !== 'string') return 'each slot needs `slot` and `jsx` strings';
    if (!slotIds.includes(s.slot)) return `"${s.slot}" is not a slot of this screen (use one of ${slotIds.join(', ')})`;
    if (seen.has(s.slot)) return `slot "${s.slot}" appears twice`;
    seen.add(s.slot);
    const jsx = s.jsx.trim();
    if (!jsx.startsWith('<') || !jsx.endsWith('>')) return `slot "${s.slot}" must be one JSX element`;
    for (const [re, why] of BANNED) if (re.test(jsx)) return `slot "${s.slot}": ${why}`;
  }
  if (root) {
    const missing = slotIds.filter((id) => !seen.has(id));
    if (missing.length) return `a root design must fill every slot; missing ${missing.join(', ')}`;
  }
  if (/@import|:global|@media/.test(x.css)) return 'css may not use @import, :global or @media (use container queries)';
  return '';
}

const pascal = (slot: string) => slot.replace(/(^|[-_])(\w)/g, (_, __, c: string) => c.toUpperCase());
const indent = (text: string, pad: string) => text.trim().split('\n').map((l) => pad + l).join('\n');

/** The variant folder's files. `brief` goes in a header comment so the folder explains itself. */
export function render(i: Pick<GenerateInput, 'id' | 'parent' | 'brief'>, a: Answer): Files {
  const comps = a.slots.map((s) => `const ${pascal(s.slot)} = () => (\n${indent(s.jsx, '  ')}\n);`);
  const tsx = [
    `// Generated by the variant agent from the brief: ${i.brief.replace(/\s+/g, ' ')}`,
    `import { defineVariant } from '../../../variants/define.ts';`,
    `import s from './styles.module.css';`,
    '',
    ...comps.flatMap((c) => [c, '']),
    'export default defineVariant({',
    `  title: ${JSON.stringify(a.title.trim())},`,
    ...(a.note.trim() ? [`  note: ${JSON.stringify(a.note.trim())},`] : []),
    `  author: 'variant agent',`,
    ...(i.parent ? [`  extends: ${JSON.stringify(i.parent)},`] : []),
    `  slots: { ${a.slots.map((s) => `${JSON.stringify(s.slot)}: ${pascal(s.slot)}`).join(', ')} },`,
    '});',
    '',
  ].join('\n');
  return { 'index.tsx': tsx, 'styles.module.css': a.css.trim() ? `${a.css.trim()}\n` : '/* no styles */\n' };
}

export interface GenerateDeps {
  llm: LLM;
  /** Called after every model call (each one is logged with log_tokens). */
  onUsage: (u: Usage, attempt: number) => void | Promise<void>;
  /** Writes the files and typechecks them; returns compiler errors for this folder, or '' when clean. */
  check: (files: Files) => Promise<string>;
}

export interface Generated { answer: Answer; files: Files; usage: Usage; attempts: number }

const ADD = (a: Usage, b: Usage): Usage => ({
  prompt_tokens: a.prompt_tokens + b.prompt_tokens,
  completion_tokens: a.completion_tokens + b.completion_tokens,
  cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens,
  cost_usd: a.cost_usd + b.cost_usd,
});
const ZERO: Usage = { prompt_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cost_usd: 0 };

/** Ask, validate, typecheck. One retry for an invalid answer and one repair round for compiler errors. */
export async function generate(i: GenerateInput, d: GenerateDeps, maxAttempts = 3): Promise<Generated> {
  const slotIds = Object.keys(i.screen.slots);
  const schema = answerSchema(slotIds);
  let usage = ZERO;
  let problem: string | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const r = await d.llm.decide<Answer>(buildPrompt(i, problem), schema, { purpose: 'design', model: i.model });
    usage = ADD(usage, r.usage);
    await d.onUsage(r.usage, attempt);
    problem = validate(r.output, slotIds, !i.parent) || undefined;
    if (problem) continue;
    const files = render(i, r.output);
    const errors = await d.check(files);
    if (!errors) return { answer: r.output, files, usage, attempts: attempt + 1 };
    problem = `it does not compile:\n${errors.slice(0, 2000)}`;
  }
  throw new Error(`no usable variant after ${maxAttempts} attempts (${problem?.split('\n')[0] ?? 'unknown'})`);
}
