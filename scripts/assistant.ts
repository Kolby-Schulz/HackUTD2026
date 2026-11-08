// scripts/assistant.ts: the dashboard's chat. Owner: dashboard + demo.
//
// You type what you want, the way you'd prompt a coding agent. One decide() call (packages/llm,
// purpose 'plan') turns it into an action, and the assistant does the rest through the control
// server's process registry (scripts/control.ts):
//   build    start the coordinator and a session if needed, then one worker per task
//            (independent pieces run in parallel; Contract coordinates them)
//   message  steer agents that are already working (send_instruction)
//   merge    merge the agents' branches and run the checks now
//   stop     stop the workers this laptop started
//   status / none   just answer
// When every worker it started has finished, it merges and runs the checks by itself and
// reports back in the chat.
import type { DecideOptions, DecideResult } from '@contract/llm';
import { toCommand, type Proc, type Registry } from './control.ts';

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant' | 'event';
  text: string;
  at: number;
}

/** What the planner needs to know about the shared database right now. */
export interface Snapshot {
  openRun?: { id: string; mode: string };
  coordinatorOnline: boolean;
  /** Worker agents seen in the last minute. */
  agents: { id: string; status: string; task?: string }[];
}

export interface Plan {
  reply: string;
  action: 'build' | 'message' | 'merge' | 'stop' | 'status' | 'none';
  tasks: { title: string; task: string }[];
  messages: { agent: string; text: string }[];
}

export interface AssistantDeps {
  reg: Registry;
  decide: (prompt: string, schema: Record<string, unknown>, opts: DecideOptions) => Promise<DecideResult<Plan>>;
  snapshot: () => Promise<Snapshot>;
  sendInstruction: (agentId: string, text: string) => Promise<void>;
}

export const MAX_TASKS = 3;
const AGENT_POOL = ['agent-a', 'agent-b', 'agent-c', 'agent-d', 'agent-e'];

export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'action', 'tasks', 'messages'],
  properties: {
    reply: { type: 'string', description: 'One to three plain sentences to the user saying what will happen (or answering them).' },
    action: { type: 'string', enum: ['build', 'message', 'merge', 'stop', 'status', 'none'] },
    tasks: {
      type: 'array',
      maxItems: MAX_TASKS,
      description: 'For build: one entry per coding agent. Empty otherwise.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'task'],
        properties: {
          title: { type: 'string', description: 'Short title, under 60 characters.' },
          task: { type: 'string', description: 'A complete, self-contained instruction for a coding agent that has not seen this chat.' },
        },
      },
    },
    messages: {
      type: 'array',
      description: "For message: what to tell running agents. agent is a working agent's id, or '*' for all of them. Empty otherwise.",
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['agent', 'text'],
        properties: { agent: { type: 'string' }, text: { type: 'string' } },
      },
    },
  },
} as const;

export function buildPrompt(text: string, snap: Snapshot, history: ChatMessage[], local: Proc[], repo = 'demo-repo'): string {
  const running = local.filter((p) => p.status === 'running').map((p) => p.label);
  const agents = snap.agents.length
    ? snap.agents.map((a) => `- ${a.id}: ${a.status}${a.task ? ` on "${a.task}"` : ''}`).join('\n')
    : '- none';
  const recent = history.slice(-8).map((m) => `${m.role}: ${m.text}`).join('\n') || '(new conversation)';
  return `You are the assistant inside Contract, a tool that runs several AI coding agents on one repository at the same time and coordinates them live so their changes don't conflict. The user chats with you the way they'd prompt a coding agent. Turn their message into exactly one action.

Actions:
- build: the user wants code written or changed. Put the work in "tasks", one entry per coding agent (at most ${MAX_TASKS}). Split only into pieces that are separate features or files and can be done in parallel; if it's one coherent change, use one task. Each task must stand alone: the agent never sees this chat, so restate any detail it needs. The system starts the coordinator, a session and the agents for you, and merges and tests when they finish.
- message: the user wants to change, correct or add to what running agents are already doing. Put the instructions in "messages" (agent id, or "*" for every working agent). Only valid while agents are working or paused.
- merge: the user wants the finished work merged and checked now.
- stop: the user wants the running agents stopped.
- status: the user asks what is happening; answer from the state below in "reply".
- none: small talk or a question you can answer directly; answer in "reply".
If a request is unclear, choose none and ask one short question in "reply".

Current state:
- Repository the agents work on: ${repo}${repo === 'demo-repo' ? ' (the built-in demo: a small TypeScript invoicing app)' : ''}
- Open run: ${snap.openRun ? `#${snap.openRun.id} (${snap.openRun.mode})` : 'none'}
- Coordinator online: ${snap.coordinatorOnline ? 'yes' : 'no'}
- Agents:
${agents}
- Processes this laptop started and still running: ${running.join(', ') || 'none'}

Recent chat:
${recent}

User: ${text}`;
}

/** Plan output from a model is untrusted: clamp it to the actions and sizes the UI expects. */
export function cleanPlan(raw: unknown): Plan {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const actions: Plan['action'][] = ['build', 'message', 'merge', 'stop', 'status', 'none'];
  const action = actions.includes(r.action as Plan['action']) ? (r.action as Plan['action']) : 'none';
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const tasks = (Array.isArray(r.tasks) ? r.tasks : [])
    .map((t) => ({ title: str((t as Record<string, unknown>)?.title).slice(0, 60), task: str((t as Record<string, unknown>)?.task).slice(0, 4000) }))
    .filter((t) => t.task)
    .slice(0, MAX_TASKS)
    .map((t) => ({ ...t, title: t.title || t.task.slice(0, 57) }));
  const messages = (Array.isArray(r.messages) ? r.messages : [])
    .map((m) => ({ agent: str((m as Record<string, unknown>)?.agent), text: str((m as Record<string, unknown>)?.text).slice(0, 2000) }))
    .filter((m) => m.agent && m.text);
  return { reply: str(r.reply) || 'OK.', action, tasks, messages };
}

export class Assistant {
  messages: ChatMessage[] = [];
  busy = false;
  /** Called whenever messages or busy change (the daemon pushes them right away). */
  onChange?: () => void;
  private nextId = 1;
  /** Worker keys started from the chat that haven't been merged yet. */
  private pending = new Set<string>();
  private merging = false;

  constructor(private deps: AssistantDeps) {}

  say(role: ChatMessage['role'], text: string) {
    this.messages.push({ id: this.nextId++, role, text, at: Date.now() });
    if (this.messages.length > 200) this.messages.splice(0, this.messages.length - 200);
    this.onChange?.();
  }

  view(after = 0) {
    return { busy: this.busy, messages: this.messages.filter((m) => m.id > after) };
  }

  /** Handles one user message. Resolves once the action has been started (not finished). */
  async chat(text: string): Promise<void> {
    const body = text.trim();
    if (!body) throw new Error('message is empty');
    if (body.length > 4000) throw new Error('message is longer than 4000 characters');
    if (this.busy) throw new Error('still working on your last message');
    this.busy = true;
    this.onChange?.();
    const history = this.messages.slice();
    this.say('user', body);
    try {
      const snap = await this.deps.snapshot();
      const { output } = await this.deps.decide(buildPrompt(body, snap, history, [...this.deps.reg.procs.values()], this.deps.reg.repoLabel()), PLAN_SCHEMA as unknown as Record<string, unknown>, { purpose: 'plan' });
      const plan = cleanPlan(output);
      this.say('assistant', plan.reply);
      await this.act(plan, snap);
    } catch (e) {
      this.say('event', `Something went wrong: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.busy = false;
      this.onChange?.();
    }
  }

  private async act(plan: Plan, snap: Snapshot) {
    const { reg } = this.deps;
    switch (plan.action) {
      case 'build': {
        if (!plan.tasks.length) return this.say('event', 'No tasks came out of that; try saying what to build.');
        if (!snap.coordinatorOnline && !this.running('coordinator')) {
          reg.start(toCommand({ action: 'coordinator' }));
          this.say('event', 'Started the coordinator.');
        }
        if (!snap.openRun || reg.needsSession()) {
          this.say('event', `Starting a session on ${reg.repoLabel()} (maps the repo)…`);
          const p = reg.start(toCommand({ action: 'session-start' }));
          const code = await p.exited;
          if (code !== 0) return this.say('event', `Couldn't start a session: ${tail(p)}`);
          this.say('event', 'Session started.');
        }
        const busyIds = new Set([
          ...snap.agents.filter((a) => a.status === 'working' || a.status === 'paused').map((a) => a.id),
          ...[...reg.procs.values()].filter((p) => p.status === 'running' && p.key.startsWith('worker:')).map((p) => p.key.slice(7)),
        ]);
        const free = AGENT_POOL.filter((id) => !busyIds.has(id));
        if (free.length < plan.tasks.length) return this.say('event', `Only ${free.length} agent slot(s) free; stop some agents first.`);
        plan.tasks.forEach((t, i) => {
          const id = free[i]!;
          const p = reg.start(toCommand({ action: 'worker', id, prompt: t.task }), (done) => this.workerDone(done));
          this.pending.add(p.key);
          this.say('event', `${id} is working on: ${t.title}`);
        });
        return;
      }
      case 'message': {
        if (!plan.messages.length) return;
        for (const m of plan.messages) {
          try {
            await this.deps.sendInstruction(m.agent, m.text);
            this.say('event', `Told ${m.agent === '*' ? 'every working agent' : m.agent}: "${m.text}"`);
          } catch (e) {
            this.say('event', `Couldn't message ${m.agent}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        return;
      }
      case 'merge':
        return this.merge();
      case 'stop': {
        let n = 0;
        for (const p of reg.procs.values()) {
          if (p.status === 'running' && p.key.startsWith('worker:')) { reg.stop(p.key); this.pending.delete(p.key); n++; }
        }
        return this.say('event', n ? `Stopped ${n} agent(s).` : 'No agents were running on this laptop.');
      }
      default:
        return;
    }
  }

  private running(key: string) {
    return this.deps.reg.procs.get(key)?.status === 'running';
  }

  private workerDone(p: Proc) {
    if (!this.pending.has(p.key)) return;
    const id = p.key.slice(7);
    if (p.status === 'stopped') {
      this.pending.delete(p.key);
      return;
    }
    this.say('event', p.code === 0 ? `${id} finished.` : `${id} stopped with an error: ${tail(p)}`);
    const stillRunning = [...this.pending].some((k) => this.running(k));
    if (!stillRunning) {
      this.pending.clear();
      void this.merge();
    }
  }

  private async merge() {
    if (this.merging || this.running('session-merge')) return this.say('event', 'A merge is already running.');
    this.merging = true;
    try {
      this.say('event', 'Merging every agent\'s branch and running the checks…');
      const p = this.deps.reg.start(toCommand({ action: 'session-merge' }));
      const code = await p.exited;
      this.say('assistant', code === 0
        ? `Done. The agents' work is merged and the checks passed. ${tail(p)}`
        : `The merge finished with problems: ${tail(p)} Open Manual controls → Processes for the full output.`);
    } finally {
      this.merging = false;
    }
  }
}

/** The last useful output lines of a process, for a chat message. */
function tail(p: Proc, n = 3): string {
  return p.log.slice(-n).map((l) => l.replace(/^\[[a-z-]+\]\s*/, '')).join(' · ').slice(0, 400) || `exit ${p.code ?? '?'}`;
}
