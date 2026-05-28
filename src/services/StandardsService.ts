import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export interface WcagCriterion {
  id: string;
  title: string;
  level: 'A' | 'AA' | 'AAA';
  version: '2.0' | '2.1' | '2.2';
  url: string;
}

export type WcagIndex = Record<string, WcagCriterion>;

const TAG_PATTERNS: Array<(tag: string) => string | null> = [
  (tag) => {
    const m = tag.match(/^wcag(\d+\.\d+\.\d+)$/i);
    return m && m[1] ? m[1] : null;
  },
  (tag) => {
    const m = tag.match(/^wcag(\d)(\d)(\d{1,2})$/i);
    if (!m) return null;
    return `${m[1]}.${m[2]}.${parseInt(m[3]!, 10)}`;
  },
];

export class StandardsService {
  constructor(private readonly index: WcagIndex) {}

  static load(): StandardsService {
    const here = dirname(fileURLToPath(import.meta.url));
    const path = join(here, '..', 'data', 'wcag-index.json');
    const raw = readFileSync(path, 'utf8');
    return new StandardsService(JSON.parse(raw) as WcagIndex);
  }

  get wcagIndex(): WcagIndex {
    return this.index;
  }

  criterion(id: string): WcagCriterion | undefined {
    return this.index[id];
  }

  criteriaFromTags(tags: string[], index: WcagIndex = this.index): WcagCriterion[] {
    const out: WcagCriterion[] = [];
    const seen = new Set<string>();
    for (const tag of tags) {
      const id = StandardsService.tagToId(tag);
      if (!id) continue;
      const crit = index[id];
      if (!crit || seen.has(id)) continue;
      seen.add(id);
      out.push(crit);
    }
    return out;
  }

  static tagToId(tag: string): string | null {
    for (const pattern of TAG_PATTERNS) {
      const id = pattern(tag);
      if (id) return id;
    }
    return null;
  }
}
