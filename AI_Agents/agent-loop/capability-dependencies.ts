/**
 * Internal prerequisite resolver for BLAST. It reads only committed capability memory and live
 * evidence; dependency selection never changes the URL/feature request contract or the UI.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CapabilityDependency {
  capabilityId: string;
  spec: string;
  moduleFile: string;
  moduleClass: string;
  method: string;
  provides: string[];
  reason: string;
  source: 'derived' | 'remembered';
}

export interface CapabilityDependencyResolution {
  version: 1;
  feature: string;
  url: string;
  dependencies: CapabilityDependency[];
  evidenceTerms: string[];
}

interface ManifestDomain {
  domain: string;
  shard: string;
}

interface Manifest {
  $schema?: string;
  sourceHash?: string;
  domains?: ManifestDomain[];
  testIndex?: Record<string, Array<{ domain?: string; spec?: string; title?: string }>>;
}

interface DependencyMemoryRecord {
  feature: string;
  artifacts: { page: string; module: string; spec: string };
  provides: string[];
  requires: CapabilityDependency[];
}

interface DependencyMemory {
  $schema: 'blast-capability-dependencies/v1';
  sourceHash?: string;
  capabilities: Record<string, DependencyMemoryRecord>;
}

interface LiveEvidence {
  applicationSummary?: { headings?: string[]; pageTitle?: string; feature?: string } | null;
  inventory?: Array<{ label?: string; accessibleName?: string; section?: string; snapshotExcerpt?: string }>;
  transitions?: Array<{ trigger?: string; revealedFields?: string[]; afterExcerpt?: string }>;
}

interface ModuleRecord {
  file: string;
  class: string;
  methods: string[];
}

const MEMORY_FILE = '.ai-memory/dependencies.json';
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with',
  'feature', 'flow', 'page', 'screen', 'test', 'verify', 'view', 'contents', 'details', 'manage',
]);
const STATE_PRODUCER = /^(add|apply|assign|choose|create|enter|fill|place|select|set|start|submit|upload)/i;

function safeJson<T>(file: string): T | undefined {
  try { return JSON.parse(readFileSync(file, 'utf8')) as T; } catch { return undefined; }
}

function words(value: string): string[] {
  const split = String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];
  return [...new Set(split
    .map((word) => word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word)))];
}

function intersection(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((word) => rightSet.has(word));
}

function readManifest(fw: string): Manifest | undefined {
  const manifest = safeJson<Manifest>(join(fw, '.ai-memory', 'capabilities.json'));
  return manifest && /v2-sharded/.test(String(manifest.$schema || '')) ? manifest : undefined;
}

function readDependencyMemory(fw: string): DependencyMemory {
  const memory = safeJson<DependencyMemory>(join(fw, MEMORY_FILE));
  if (memory?.$schema === 'blast-capability-dependencies/v1' && memory.capabilities) return memory;
  return { $schema: 'blast-capability-dependencies/v1', capabilities: {} };
}

function liveEvidenceTerms(evidence?: LiveEvidence): string[] {
  if (!evidence) return [];
  const values: string[] = [
    evidence.applicationSummary?.feature || '', evidence.applicationSummary?.pageTitle || '',
    ...(evidence.applicationSummary?.headings || []),
  ];
  for (const item of evidence.inventory || []) {
    values.push(item.label || '', item.accessibleName || '', item.section || '', item.snapshotExcerpt || '');
  }
  for (const transition of evidence.transitions || []) {
    values.push(transition.trigger || '', transition.afterExcerpt || '', ...(transition.revealedFields || []));
  }
  return [...new Set(values.flatMap(words))];
}

function titlesForDomain(manifest: Manifest, domain: string): Array<{ spec: string; title: string }> {
  const titles: Array<{ spec: string; title: string }> = [];
  for (const entries of Object.values(manifest.testIndex || {})) {
    for (const entry of entries || []) {
      if (entry.domain === domain && entry.spec && entry.title) titles.push({ spec: entry.spec, title: entry.title });
    }
  }
  return titles;
}

function existingModules(fw: string, manifest: Manifest): Array<ModuleRecord & { domain: string; specs: Array<{ spec: string; title: string }> }> {
  const modules: Array<ModuleRecord & { domain: string; specs: Array<{ spec: string; title: string }> }> = [];
  for (const domain of manifest.domains || []) {
    const shard = safeJson<{ modules?: ModuleRecord[] }>(join(fw, domain.shard));
    for (const module of shard?.modules || []) {
      if (!module?.file || !module.class || !Array.isArray(module.methods)) continue;
      modules.push({ ...module, domain: domain.domain, specs: titlesForDomain(manifest, domain.domain) });
    }
  }
  return modules;
}

function isSameCapability(featureTokens: string[], titles: Array<{ title: string }>): boolean {
  return featureTokens.length >= 2 && titles.some(({ title }) => {
    const titleTokens = words(title);
    return titleTokens.length >= 2 && featureTokens.every((token) => titleTokens.includes(token));
  });
}

/**
 * Resolve prerequisite workflows internally. A dependency is selected only when a verified Module
 * method is state-producing and shares meaningful feature/live-evidence terms with the request.
 */
export function resolveCapabilityDependencies(
  fw: string,
  feature: string,
  url: string,
  liveEvidence?: LiveEvidence,
): CapabilityDependencyResolution {
  const manifest = readManifest(fw);
  const targetTerms = [...new Set([...words(feature), ...liveEvidenceTerms(liveEvidence)])];
  const resolution: CapabilityDependencyResolution = { version: 1, feature, url, dependencies: [], evidenceTerms: targetTerms };
  if (!manifest || !targetTerms.length) return resolution;

  const memory = readDependencyMemory(fw);
  const remembered = Object.values(memory.capabilities)
    .filter((record) => words(record.feature).some((term) => targetTerms.includes(term)))
    .flatMap((record) => record.requires || [])
    .filter((dependency) => dependency.provides.some((term) => targetTerms.includes(term)))
    .map((dependency) => ({ ...dependency, source: 'remembered' as const }));

  const candidates: Array<CapabilityDependency & { score: number }> = [];
  for (const module of existingModules(fw, manifest)) {
    if (isSameCapability(words(feature), module.specs)) continue;
    for (const method of module.methods) {
      if (!STATE_PRODUCER.test(method)) continue;
      const shared = intersection(targetTerms, words(method));
      if (!shared.length) continue;
      const matchingSpec = module.specs.find(({ title }) => intersection(shared, words(title)).length > 0);
      if (!matchingSpec) continue;
      candidates.push({
        capabilityId: `${matchingSpec.spec}#${method}`,
        spec: matchingSpec.spec,
        moduleFile: module.file,
        moduleClass: module.class,
        method,
        provides: shared.sort(),
        reason: `Verified ${module.class}.${method} establishes the shared state ${shared.map((term) => `'${term}'`).join(', ')} needed by "${feature}".`,
        source: 'derived',
        score: shared.length * 10 + 1,
      });
    }
  }

  // One deterministic workflow per state keeps setup minimal and stable across runs.
  const selected = new Map<string, CapabilityDependency>();
  for (const candidate of [...remembered, ...candidates.sort((a, b) => b.score - a.score || a.capabilityId.localeCompare(b.capabilityId))]) {
    const state = [...candidate.provides].sort().join('|');
    if (!state || selected.has(state)) continue;
    selected.set(state, candidate);
  }
  resolution.dependencies = [...selected.values()].slice(0, 3);
  return resolution;
}

/** Render private resolution data for engine prompts. It is never a user-facing field or choice. */
export function dependencyResolutionContext(resolution?: CapabilityDependencyResolution): string {
  if (!resolution?.dependencies.length) return '(no verified prerequisite capability was resolved)';
  return resolution.dependencies.map((dependency) =>
    `- ${dependency.moduleClass}.${dependency.method}() from ${dependency.moduleFile} [verified by ${dependency.spec}] `
    + `establishes ${dependency.provides.join(', ')}. ${dependency.reason}`,
  ).join('\n');
}

/** Reject an artifact that ignores a prerequisite selected by the internal resolver. */
export function assertResolvedDependenciesUsed(moduleContent: string, resolution?: CapabilityDependencyResolution): void {
  for (const dependency of resolution?.dependencies || []) {
    const classPattern = new RegExp(`\\bnew\\s+${dependency.moduleClass}\\s*\\(`);
    const methodPattern = new RegExp(`\\.\\s*${dependency.method}\\s*\\(`);
    if (classPattern.test(moduleContent) && methodPattern.test(moduleContent)) continue;
    throw new Error(
      `Codegen: the internally resolved prerequisite ${dependency.moduleClass}.${dependency.method}() was not reused in the generated Module. `
      + `Existing verified dependency: ${dependency.moduleFile} → ${dependency.spec}. `
      + 'Construct that existing Module and call its verified workflow to establish the prerequisite; preserve its Page/Module/Spec artifacts and implement only the missing capability. Do NOT recreate its locator or workflow.',
    );
  }
}

/** Preserve the verified prerequisite assets: a new capability may delegate to them, never replace them. */
export function assertDependencyArtifactsPreserved(
  artifacts: { page: string; module: string; spec: string },
  resolution?: CapabilityDependencyResolution,
): void {
  for (const dependency of resolution?.dependencies || []) {
    const overwritten = [artifacts.module, artifacts.spec]
      .map((file) => String(file || '').replace(/\\/g, '/'))
      .find((file) => file === dependency.moduleFile || file === dependency.spec);
    if (!overwritten) continue;
    throw new Error(
      `Codegen: generated artifact ${overwritten} would overwrite the internally resolved prerequisite ${dependency.capabilityId}. `
      + `Preserve ${dependency.moduleFile} and ${dependency.spec}; create or extend only the new capability's artifacts, then delegate to ${dependency.moduleClass}.${dependency.method}() for setup.`,
    );
  }
}

/** Persist internal relationships alongside (but separate from) the generated capability API index. */
export function writeCapabilityDependencyMemory(
  fw: string,
  feature: string,
  artifacts: { page: string; module: string; spec: string },
  resolution?: CapabilityDependencyResolution,
): string | undefined {
  const requires = resolution?.dependencies || [];
  if (!requires.length) return undefined;
  const memory = readDependencyMemory(fw);
  memory.sourceHash = readManifest(fw)?.sourceHash;
  memory.capabilities[artifacts.spec] = { feature, artifacts, provides: words(feature), requires };
  const file = join(fw, MEMORY_FILE);
  mkdirSync(join(fw, '.ai-memory'), { recursive: true });
  writeFileSync(file, JSON.stringify(memory, null, 2) + '\n');
  return MEMORY_FILE;
}