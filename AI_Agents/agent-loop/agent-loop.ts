/**
 * agent-loop.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * A standalone, environment-agnostic reproduction of Copilot agent-mode's browser
 * loop. It drives a REAL headless @playwright/cli session one action at a time, so
 * it behaves IDENTICALLY on your laptop, a cloud VM, or a GitHub Actions runner.
 *
 * THE ENTIRE FIX (why this works where blind batch-execution failed):
 *   The model NEVER pre-generates a batch of commands. It picks ONE tool call,
 *   we execute it against the live browser, and the REAL result (or a fresh
 *   snapshot with the currently-valid refs) goes back before it decides the next
 *   action. Refs (e15, f3e7…) are only ever used from the most recent snapshot —
 *   a ref that is not live is rejected, so the model must snapshot and re-pick.
 *
 * ── SETUP (run the same 3 lines everywhere: local, VM, GitHub Actions) ─────────
 *   npm i -g @playwright/cli
 *   npx playwright install --with-deps chromium
 *   # this module needs: npm i openai   (and tsx/ts-node OR compile with tsc)
 *
 * ── RUN ────────────────────────────────────────────────────────────────────────
 *   OPENAI_API_KEY=...  \
 *   npx tsx agent-loop.ts --url "https://app.example.com/feature" \
 *                         --goal "Log out via the user-profile dropdown and verify the login page appears"
 *
 *   Optional:
 *     --model <name>        (or env OPENAI_MODEL; default gpt-4o)
 *     --max <n>             max live steps (default 25)
 *     --state <file.json>   pre-saved storage state for auth (no creds via the CLI)
 *     OPENAI_BASE_URL       custom OpenAI-compatible gateway
 *     PLAYWRIGHT_CLI_BIN    override the playwright-cli executable name
 *
 * Exit code: 0 when finish status is "passed", 1 otherwise (CI-friendly).
 */

import OpenAI from 'openai';
import { existsSync } from 'node:fs';
import {
  CliSession, TOOLS, REF_TOOLS, buildCommand,
  extractYaml, extractRanLocator, extractPageUrl, parseRefs, redact,
  resolveCredentials, substituteCredentials, type Credentials,
  type RefRow,
} from './playwright-cli-tools';

export interface AgentLoopOptions {
  /** Feature name + concrete instructions describing what to explore/verify. */
  goal: string;
  /** The single feature URL to start on. */
  url: string;
  model?: string;
  /** Max live tool calls before the loop stops itself. Default 25. */
  maxSteps?: number;
  /** Optional saved storage state (cookies) so an authed feature is reachable without a live login. */
  stateFile?: string;
  /** Login credentials — read from env by default; the LLM never receives these values. */
  credentials?: Credentials;
  /** Extra values to redact from all logs/traces (creds are always redacted regardless). */
  secrets?: string[];
  onLog?: (line: string) => void;
}

export interface AgentStep {
  tool: string;
  args: Record<string, unknown>;
  locator?: string;
  url?: string;
  result: string;
}

export interface AgentLoopResult {
  status: 'passed' | 'failed' | 'incomplete';
  summary: string;
  steps: AgentStep[];
}

const SYSTEM_PROMPT = [
  'You are a browser-automation agent driving a REAL headless browser to explore and verify ONE feature.',
  'You act by calling the provided tools, ONE at a time, and reading the real result before the next call.',
  '',
  'HARD RULES:',
  '1. ALWAYS call `snapshot` before any ref-based action. Refs (e15, f3e7…) are ONLY valid for the snapshot you just read.',
  '2. Use ONLY refs that appear in the MOST RECENT snapshot. Never invent a ref or reuse one from an earlier page state.',
  '3. Do the MINIMUM to advance the goal: one action, then snapshot again, then the next action.',
  '4. To reveal a hidden control (Logout, Settings, a menu item), first CLICK the thing that opens it — a user avatar/profile image, a ⋮/kebab/hamburger/caret icon, or a top-bar user-name toggle — then snapshot; the revealed items appear in the NEXT snapshot.',
  '5. LOGIN: when a login form is present and the goal needs an authenticated page, fill the username field with the literal placeholder {{USERNAME}} and the password field with {{PASSWORD}}, then submit. The real values are injected securely — you must NEVER write an actual username or password. After you are logged in, do not re-enter credentials.',
  '6. When the goal is achieved (or no useful action remains), call `finish` with status "passed" (goal verified), "failed" (a real defect/blocker), or "incomplete".',
  '',
  'Work efficiently and do not narrate — just make tool calls.',
].join('\n');

/** Render the live refs the model is allowed to act on, most-relevant first. */
function renderRefs(refs: RefRow[]): string {
  if (!refs.length) return '(no interactable elements found on this page)';
  return refs.slice(0, 60).map((r) => `- ref=${r.ref} ${r.role}${r.name ? ` "${r.name}"` : ''}`).join('\n');
}

export async function runAgentLoop(opts: AgentLoopOptions): Promise<AgentLoopResult> {
  const log = opts.onLog || ((l: string) => console.log(l));
  const creds = opts.credentials || resolveCredentials();
  // Credential VALUES are always redacted from logs/traces/tool results — they never reach the LLM.
  const secrets = [...(opts.secrets || []), creds.username, creds.password].filter(Boolean);
  const maxSteps = opts.maxSteps && opts.maxSteps > 0 ? opts.maxSteps : 25;
  const model = opts.model || process.env.OPENAI_MODEL || 'gpt-4o';

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });

  const session = new CliSession();
  const steps: AgentStep[] = [];
  let liveRefs = new Set<string>();

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `# Feature URL\n${opts.url}\n\n# Goal\n${opts.goal}` },
  ];

  const finish = (status: AgentLoopResult['status'], summary: string): AgentLoopResult => ({ status, summary, steps });

  try {
    // Open a headless session, optionally load a saved auth state, then land on the feature URL.
    await session.run(['open']);
    if (opts.stateFile && existsSync(opts.stateFile)) {
      await session.run(['state-load', opts.stateFile]);
      log('[agent] Loaded saved storage state (no credentials pass through the CLI).');
    }
    const gotoOut = await session.run(['goto', opts.url]);
    log(`[agent] Opened ${extractPageUrl(gotoOut) || opts.url}`);

    for (let step = 1; step <= maxSteps; step++) {
      const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
        model,
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        parallel_tool_calls: false, // one live action at a time — the core of the fix
        temperature: 0,
      };
      // Some gateways force a default reasoning_effort that conflicts with function tools on
      // /v1/chat/completions. Send OPENAI_REASONING_EFFORT (e.g. "none") only when it is set.
      const effort = (process.env.OPENAI_REASONING_EFFORT || '').trim();
      if (effort) (params as unknown as Record<string, unknown>).reasoning_effort = effort;
      const completion = await client.chat.completions.create(params);

      const choice = completion.choices[0]?.message;
      if (!choice) return finish('incomplete', 'No response from the model.');

      // No tool call → the model is done talking; treat as incomplete unless it explicitly finished.
      const toolCalls = choice.tool_calls || [];
      if (!toolCalls.length) {
        return finish('incomplete', choice.content || 'Model returned no tool call.');
      }

      messages.push(choice);

      // parallel_tool_calls is off, so there is exactly one call to service.
      const call = toolCalls[0];
      if (call.type !== 'function') {
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'Unsupported tool call type.' });
        continue;
      }
      const name = call.function.name;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function.arguments || '{}'); } catch { /* keep {} */ }

      // Terminal tool.
      if (name === 'finish') {
        const status = (['passed', 'failed', 'incomplete'].includes(String(args.status)) ? args.status : 'incomplete') as AgentLoopResult['status'];
        const summary = String(args.summary || '');
        messages.push({ role: 'tool', tool_call_id: call.id, content: 'ok' });
        log(`[agent] finish → ${status}: ${summary}`);
        return finish(status, summary);
      }

      // Anti-hallucination guard: a ref-based action must target a ref from the latest snapshot.
      if (REF_TOOLS.has(name)) {
        const ref = String(args.ref || '');
        if (!liveRefs.has(ref)) {
          const msg = `Ref "${ref}" is not present in the most recent snapshot. Call snapshot first and pick a ref from the returned list.`;
          messages.push({ role: 'tool', tool_call_id: call.id, content: msg });
          log(`[agent] ✗ ${name}(${ref}) rejected — stale/invalid ref; asking model to snapshot.`);
          continue;
        }
      }

      // For fill/type, swap credential placeholders for the real env values RIGHT BEFORE running the
      // CLI. The model only ever emits {{USERNAME}}/{{PASSWORD}}, so the real secret never enters the
      // transcript; the executed action still performs a genuine login. The value we keep in the
      // trace (for codegen) stays the placeholder, and all output is redacted.
      let placeholderValue = '';
      if (name === 'fill' || name === 'type') {
        const rawVal = String((name === 'fill' ? args.value : args.text) ?? '');
        placeholderValue = rawVal;
        const { value: realVal } = substituteCredentials(rawVal, creds);
        if (name === 'fill') args = { ...args, value: realVal };
        else args = { ...args, text: realVal };
      }

      const argv = buildCommand(name, args);
      if (!argv) {
        messages.push({ role: 'tool', tool_call_id: call.id, content: `Missing required argument(s) for ${name}.` });
        continue;
      }

      const raw = await session.run(argv);
      let toolResult: string;

      if (name === 'snapshot') {
        const yaml = extractYaml(raw);
        const refs = parseRefs(yaml);
        liveRefs = new Set(refs.map((r) => r.ref));
        toolResult = `Current URL: ${extractPageUrl(raw) || '(unchanged)'}\n\nInteractable elements you may act on now:\n${renderRefs(refs)}\n\nPage tree (context):\n${yaml.slice(0, 2500)}`;
        log(`[agent] snapshot → ${refs.length} interactable element(s)`);
      } else {
        const locator = extractRanLocator(raw);
        const pageUrl = extractPageUrl(raw);
        // After any navigation/action the old refs are stale — force a fresh snapshot next.
        if (name === 'goto' || name === 'goBack') liveRefs = new Set();
        // Persist the PLACEHOLDER (never the real credential) so codegen stays secret-free.
        const recordedArgs = placeholderValue
          ? { ...args, ...(name === 'fill' ? { value: placeholderValue } : { text: placeholderValue }) }
          : args;
        steps.push({ tool: name, args: recordedArgs, locator, url: pageUrl, result: redact(raw, secrets).slice(0, 400) });
        toolResult = [
          locator ? `Ran: ${redact(locator, secrets)}` : 'Action executed.',
          pageUrl ? `Current URL: ${pageUrl}` : '',
          'Call snapshot to see the updated page before your next ref-based action.',
        ].filter(Boolean).join('\n');
        log(`[agent] ${step}. ${name} ✓${pageUrl ? ` (→ ${pageUrl})` : ''}`);
      }

      messages.push({ role: 'tool', tool_call_id: call.id, content: redact(toolResult, secrets) });
    }

    return finish('incomplete', `Reached the ${maxSteps}-step budget without finishing.`);
  } catch (e) {
    return finish('failed', `Loop error: ${(e as Error).message}`);
  } finally {
    await session.run(['close']).catch(() => {});
  }
}

/* ── CLI entrypoint: `npx tsx agent-loop.ts --url … --goal …` ─────────────────── */

function parseArgv(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[key] = val;
    }
  }
  return out;
}

const invokedDirectly =
  (process.argv[1] || '').replace(/\\/g, '/').endsWith('agent-loop.ts') ||
  (process.argv[1] || '').replace(/\\/g, '/').endsWith('agent-loop.js') ||
  process.env.AGENT_LOOP_MAIN === '1';

if (invokedDirectly) {
  const args = parseArgv(process.argv.slice(2));
  const url = args.url || process.env.AGENT_URL || '';
  const goal = args.goal || process.env.AGENT_GOAL || '';
  if (!url || !goal) {
    console.error('Usage: npx tsx agent-loop.ts --url <feature-url> --goal "<what to explore/verify>"');
    process.exit(2);
  }
  runAgentLoop({
    url,
    goal,
    model: args.model,
    maxSteps: args.max ? Number(args.max) : undefined,
    stateFile: args.state,
    secrets: (process.env.AGENT_SECRETS || '').split(',').map((s) => s.trim()).filter(Boolean),
  })
    .then((res) => {
      console.log(`\n=== RESULT: ${res.status.toUpperCase()} ===\n${res.summary}`);
      console.log(`\nProven actions (${res.steps.length}):`);
      res.steps.forEach((s, i) => console.log(`${i + 1}. ${s.tool}${s.locator ? ` → ${s.locator.replace(/\s+/g, ' ').slice(0, 160)}` : ''}`));
      process.exit(res.status === 'passed' ? 0 : 1);
    })
    .catch((e) => { console.error('Fatal:', e.message); process.exit(1); });
}
