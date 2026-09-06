#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ISSUE_PAGE_SIZE = 100;
const DIAGNOSTIC = Object.freeze({
  cycle: 'GOV_ISSUE_DEPENDENCY_CYCLE',
  incomplete: 'GOV_ISSUE_SNAPSHOT_INCOMPLETE',
  parentMismatch: 'GOV_ISSUE_PARENT_MISMATCH',
  projectionBackfill: 'GOV_PROJECTION_REMOVAL_NATIVE_BACKFILL_REQUIRED',
  projectionParity: 'GOV_PROJECTION_REMOVAL_NATIVE_PARITY_REQUIRED',
  referenceMissing: 'GOV_ISSUE_REFERENCE_MISSING',
});

const byNumber = (left, right) => left.number - right.number;
const numeric = (left, right) => left - right;

function diagnostic(code) {
  return Object.freeze({ code });
}

function uniqueSorted(numbers) {
  return [...new Set(numbers)].toSorted(numeric);
}

function normaliseState(state) {
  const normalised = String(state).toUpperCase();
  if (normalised !== 'OPEN' && normalised !== 'CLOSED') {
    throw new Error(`native relationship source returned unsupported issue state "${String(state)}"`);
  }
  return normalised;
}

function normaliseLabels(labels) {
  if (!Array.isArray(labels)) return undefined;
  return labels
    .map(label => (typeof label === 'string' ? label : label?.name))
    .filter(label => typeof label === 'string')
    .toSorted();
}

function normaliseIssue(issue) {
  if (!Number.isInteger(issue?.number) || issue.number <= 0) {
    throw new Error('native relationship source returned an issue without a positive integer number');
  }
  const labels = normaliseLabels(issue.labels);
  return {
    number: issue.number,
    state: normaliseState(issue.state),
    ...(typeof issue.title === 'string' ? { title: issue.title } : {}),
    ...(labels === undefined ? {} : { labels }),
    ...(typeof issue.isSubIssue === 'boolean' ? { isSubIssue: issue.isSubIssue } : {}),
  };
}

function normaliseParent(parent) {
  if (parent === undefined) return undefined;
  if (parent === null) return null;
  if (!Number.isInteger(parent) || parent <= 0) {
    throw new Error('native relationship source returned an invalid parent issue number');
  }
  return parent;
}

function normaliseRelationshipRow(row, overrides = {}) {
  const reads = row.relationshipReads;
  const parent = Object.hasOwn(overrides, 'parent') ? overrides.parent : row.parent;
  return {
    issue: normaliseIssue({
      ...row,
      ...(overrides.isSubIssue === undefined ? {} : { isSubIssue: overrides.isSubIssue }),
    }),
    parent: normaliseParent(parent),
    readSubIssues: overrides.readSubIssues ?? reads?.subIssues ?? true,
    readBlockedBy: overrides.readBlockedBy ?? reads?.blockedBy ?? true,
  };
}

function mergeOptionalField(target, incoming, field, issueNumber) {
  if (incoming[field] === undefined) return;
  if (target[field] !== undefined && JSON.stringify(target[field]) !== JSON.stringify(incoming[field])) {
    throw new Error(`native relationship sources disagree about #${String(issueNumber)} field ${field}`);
  }
  target[field] = incoming[field];
}

function mergeRelationshipRow(entries, queue, row, overrides = {}) {
  const current = entries.get(row.number);
  const hydrated =
    row.state === undefined && current !== undefined
      ? {
          ...current.issue,
          ...row,
        }
      : row;
  const incoming = normaliseRelationshipRow(hydrated, overrides);
  const number = incoming.issue.number;
  if (current === undefined) {
    entries.set(number, {
      issue: incoming.issue,
      parent: incoming.parent,
      readSubIssues: incoming.readSubIssues,
      readBlockedBy: incoming.readBlockedBy,
    });
    queue.push(number);
    return;
  }
  if (current.issue.state !== incoming.issue.state) {
    throw new Error(`native relationship sources disagree about #${String(number)} state`);
  }
  mergeOptionalField(current.issue, incoming.issue, 'title', number);
  mergeOptionalField(current.issue, incoming.issue, 'labels', number);
  mergeOptionalField(current.issue, incoming.issue, 'isSubIssue', number);
  if (incoming.parent !== undefined) {
    if (current.parent !== undefined && current.parent !== incoming.parent) {
      throw new Error(`native relationship sources disagree about #${String(number)} parent`);
    }
    current.parent = incoming.parent;
  }
  current.readSubIssues ||= incoming.readSubIssues;
  current.readBlockedBy ||= incoming.readBlockedBy;
}

async function collectPages(reader, description) {
  const items = [];
  const visited = new Set();
  let page = 1;
  while (page !== null) {
    if (!Number.isInteger(page) || page <= 0 || visited.has(page)) {
      throw new Error(`${description} pagination is incomplete or cyclic at page ${String(page)}`);
    }
    visited.add(page);
    const result = await reader(page);
    if (result === null || !Array.isArray(result.items)) {
      throw new Error(`${description} page ${String(page)} did not return an items array`);
    }
    if (result.nextPage !== null && (!Number.isInteger(result.nextPage) || result.nextPage <= 0)) {
      throw new Error(`${description} page ${String(page)} returned an invalid next page`);
    }
    items.push(...result.items);
    page = result.nextPage;
  }
  return items;
}

function relationshipError(report) {
  return new Error(renderNativeRelationshipDiagnostics(report).trim());
}

function cloneIssue(issue) {
  return {
    ...issue,
    subIssues: [...issue.subIssues],
    blockedBy: [...issue.blockedBy],
    ...(Array.isArray(issue.labels) ? { labels: [...issue.labels] } : {}),
  };
}

function inferredSubIssue(issue, hasExplicitScope) {
  if (hasExplicitScope) return issue.isSubIssue === true;
  return issue.parent !== null || (issue.state === 'OPEN' && issue.subIssues.length === 0);
}

function openSubIssues(snapshot) {
  const hasExplicitScope = snapshot.issues.some(issue => typeof issue.isSubIssue === 'boolean');
  return snapshot.issues
    .filter(issue => issue.state === 'OPEN' && inferredSubIssue(issue, hasExplicitScope))
    .toSorted(byNumber);
}

function issueIndex(snapshot) {
  return new Map(snapshot.issues.map(issue => [issue.number, issue]));
}

function shortestDependencyCycle(issues) {
  const index = new Map(issues.map(issue => [issue.number, issue]));
  let best = null;

  for (const start of [...index.keys()].toSorted(numeric)) {
    const queue = [[start]];
    const shortestTo = new Map([[start, 0]]);
    while (queue.length > 0) {
      const path = queue.shift();
      const tail = path.at(-1);
      const issue = index.get(tail);
      if (issue === undefined) continue;
      for (const blocker of issue.blockedBy.toSorted(numeric)) {
        if (blocker === start) {
          const candidate = [...path, start];
          if (
            best === null ||
            candidate.length < best.length ||
            (candidate.length === best.length && candidate.join(',') < best.join(','))
          ) {
            best = candidate;
          }
          continue;
        }
        if (!index.has(blocker) || path.includes(blocker)) continue;
        const distance = path.length;
        const known = shortestTo.get(blocker);
        if (known !== undefined && known < distance) continue;
        shortestTo.set(blocker, distance);
        queue.push([...path, blocker]);
      }
    }
  }
  return best;
}

export async function readNativeRelationshipSnapshot({ repository, capturedAt, source }) {
  if (typeof repository !== 'string' || repository.length === 0) throw new Error('repository is required');
  if (typeof capturedAt !== 'string' || capturedAt.length === 0) throw new Error('capturedAt is required');
  if (source === null || typeof source !== 'object') throw new Error('native relationship source is required');

  const entries = new Map();
  const queue = [];
  const issueRows = await collectPages(page => source.listIssues(page), 'issue collection');
  for (const row of issueRows) mergeRelationshipRow(entries, queue, row);
  const childrenByParent = new Map();
  const blockersByIssue = new Map();
  const parentByChild = new Map();
  const readSubIssues = new Set();
  const readBlockedBy = new Set();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const number = queue[cursor];
    const entry = entries.get(number);
    if (entry === undefined) continue;

    if (entry.parent !== undefined && entry.parent !== null && !entries.has(entry.parent)) {
      if (typeof source.getIssue !== 'function') {
        throw new Error(`native relationship source omitted parent #${String(entry.parent)} for #${String(number)}`);
      }
      const parentRow = await source.getIssue(entry.parent);
      if (normaliseState(parentRow.state) === 'OPEN') {
        throw new Error(`paginated open issue collection omitted referenced parent #${String(entry.parent)}`);
      }
      mergeRelationshipRow(entries, queue, parentRow, {
        readSubIssues: true,
        readBlockedBy: false,
      });
    }

    if (entry.readSubIssues && !readSubIssues.has(number)) {
      readSubIssues.add(number);
      const childRows = await collectPages(
        page => source.listSubIssues(number, page),
        `sub-issues for #${String(number)}`,
      );
      const children = uniqueSorted(childRows.map(child => child.number));
      childrenByParent.set(number, children);
      for (const childRow of childRows) {
        const childOpen = childRow.state !== undefined && normaliseState(childRow.state) === 'OPEN';
        if (childOpen && !entries.has(childRow.number)) {
          throw new Error(`paginated open issue collection omitted referenced child #${String(childRow.number)}`);
        }
        mergeRelationshipRow(entries, queue, childRow, {
          parent: number,
          isSubIssue: true,
          readSubIssues: childOpen && childRow.relationshipReads?.subIssues === true,
          readBlockedBy: childOpen && childRow.relationshipReads?.blockedBy === true,
        });
      }
      for (const child of children) {
        const previous = parentByChild.get(child);
        if (previous !== undefined && previous !== number) {
          throw new Error(
            `native parent collections disagree for #${String(child)}: #${String(previous)} and #${String(number)}`,
          );
        }
        parentByChild.set(child, number);
      }
    } else if (!childrenByParent.has(number)) {
      childrenByParent.set(number, []);
    }

    if (entry.readBlockedBy && !readBlockedBy.has(number)) {
      readBlockedBy.add(number);
      const blockerRows = await collectPages(
        page => source.listBlockedBy(number, page),
        `blocked-by relationships for #${String(number)}`,
      );
      blockersByIssue.set(number, uniqueSorted(blockerRows.map(blocker => blocker.number)));
      for (const blockerRow of blockerRows) {
        const knownBlocker = entries.get(blockerRow.number)?.issue;
        const hydratedBlocker =
          blockerRow.state === undefined && knownBlocker !== undefined
            ? {
                ...knownBlocker,
                ...blockerRow,
              }
            : blockerRow;
        if (normaliseState(hydratedBlocker.state) === 'OPEN' && knownBlocker === undefined) {
          throw new Error(`paginated open issue collection omitted referenced blocker #${String(blockerRow.number)}`);
        }
        const preservedRow =
          normaliseState(hydratedBlocker.state) === 'CLOSED'
            ? {
                number: hydratedBlocker.number,
                state: hydratedBlocker.state,
                ...(typeof hydratedBlocker.title === 'string' ? { title: hydratedBlocker.title } : {}),
                ...(Array.isArray(hydratedBlocker.labels) ? { labels: hydratedBlocker.labels } : {}),
              }
            : hydratedBlocker;
        mergeRelationshipRow(entries, queue, preservedRow, {
          readSubIssues: false,
          readBlockedBy: false,
        });
      }
    } else if (!blockersByIssue.has(number)) {
      blockersByIssue.set(number, []);
    }
  }

  for (const [number, entry] of entries) {
    if (entry.parent !== undefined && entry.parent !== null) {
      const previous = parentByChild.get(number);
      if (previous !== undefined && previous !== entry.parent) {
        throw new Error(
          `native parent metadata disagrees for #${String(number)}: #${String(previous)} and #${String(entry.parent)}`,
        );
      }
      parentByChild.set(number, entry.parent);
    }
  }

  const snapshot = {
    repository,
    capturedAt,
    complete: true,
    issues: [...entries.values()]
      .map(entry => entry.issue)
      .toSorted(byNumber)
      .map(issue => ({
        ...issue,
        parent: parentByChild.get(issue.number) ?? null,
        subIssues: childrenByParent.get(issue.number) ?? [],
        blockedBy: blockersByIssue.get(issue.number) ?? [],
        ...(typeof issue.isSubIssue === 'boolean'
          ? { isSubIssue: issue.isSubIssue }
          : { isSubIssue: parentByChild.has(issue.number) }),
      })),
  };
  const report = validateNativeRelationshipSnapshot(snapshot);
  if (report.diagnostics.length > 0) throw relationshipError(report);
  return snapshot;
}

export function validateNativeRelationshipSnapshot(snapshot) {
  const codes = new Set();
  if (snapshot?.complete !== true || !Array.isArray(snapshot?.issues)) {
    return Object.freeze({ diagnostics: Object.freeze([diagnostic(DIAGNOSTIC.incomplete)]) });
  }

  const issues = new Map();
  for (const issue of snapshot.issues) {
    if (!Number.isInteger(issue?.number) || issues.has(issue.number)) {
      codes.add(DIAGNOSTIC.incomplete);
      continue;
    }
    issues.set(issue.number, issue);
  }

  for (const issue of snapshot.issues) {
    if (!Array.isArray(issue.subIssues) || !Array.isArray(issue.blockedBy)) {
      codes.add(DIAGNOSTIC.incomplete);
      continue;
    }
    if (issue.parent !== null) {
      const parent = issues.get(issue.parent);
      if (parent === undefined) codes.add(DIAGNOSTIC.referenceMissing);
      else if (!parent.subIssues.includes(issue.number)) codes.add(DIAGNOSTIC.parentMismatch);
    }
    for (const childNumber of issue.subIssues) {
      const child = issues.get(childNumber);
      if (child === undefined) codes.add(DIAGNOSTIC.referenceMissing);
      else if (child.parent !== issue.number) codes.add(DIAGNOSTIC.parentMismatch);
    }
    for (const blocker of issue.blockedBy) {
      if (!issues.has(blocker)) codes.add(DIAGNOSTIC.referenceMissing);
    }
  }

  const cycle = shortestDependencyCycle(snapshot.issues);
  if (cycle !== null) codes.add(DIAGNOSTIC.cycle);
  return Object.freeze({
    diagnostics: Object.freeze([...codes].toSorted().map(diagnostic)),
    ...(cycle === null ? {} : { cycle: Object.freeze(cycle) }),
  });
}

export function renderNativeRelationshipDiagnostics(report) {
  return report.diagnostics
    .map(entry =>
      entry.code === DIAGNOSTIC.cycle && Array.isArray(report.cycle)
        ? `[${entry.code}] ${report.cycle.join(' -> ')}`
        : `[${entry.code}]`,
    )
    .join('\n')
    .concat(report.diagnostics.length === 0 ? '' : '\n');
}

export function computeActionability(snapshot) {
  const validation = validateNativeRelationshipSnapshot(snapshot);
  if (validation.diagnostics.length > 0) throw relationshipError(validation);
  const issues = issueIndex(snapshot);
  const actionable = [];
  const blocked = [];
  for (const issue of openSubIssues(snapshot)) {
    const hasOpenBlocker = issue.blockedBy.some(number => issues.get(number)?.state === 'OPEN');
    (hasOpenBlocker ? blocked : actionable).push(issue.number);
  }
  return Object.freeze({
    actionable: Object.freeze(actionable),
    blocked: Object.freeze(blocked),
  });
}

export function renderActionabilityReport(snapshot) {
  const result = computeActionability(snapshot);
  return [
    'native issue actionability report v1',
    `repository ${snapshot.repository}`,
    `captured-at ${snapshot.capturedAt}`,
    `actionable ${result.actionable.join(' ')}`.trimEnd(),
    `blocked ${result.blocked.join(' ')}`.trimEnd(),
    '',
  ].join('\n');
}

export function applyNativeRelationshipBackfill(snapshot, repair) {
  if (repair?.issue !== 730 || repair?.parent !== 644 || repair?.blockedBy !== 652) {
    throw new Error('only the reviewed #730 parent #644 and blocker #652 backfill is accepted');
  }
  const validation = validateNativeRelationshipSnapshot(snapshot);
  if (validation.diagnostics.length > 0) throw relationshipError(validation);

  const issues = new Map(snapshot.issues.map(issue => [issue.number, cloneIssue(issue)]));
  const issue = issues.get(repair.issue);
  const parent = issues.get(repair.parent);
  const blocker = issues.get(repair.blockedBy);
  if (issue === undefined || parent === undefined || blocker === undefined) {
    throw new Error('the #730 backfill requires #730, #644 and #652 in the complete snapshot');
  }
  if (issue.parent !== null && issue.parent !== repair.parent) {
    throw new Error(`#730 already has unexpected native parent #${String(issue.parent)}`);
  }
  issue.parent = repair.parent;
  issue.blockedBy = uniqueSorted([...issue.blockedBy, repair.blockedBy]);
  if (typeof issue.isSubIssue === 'boolean') issue.isSubIssue = true;
  parent.subIssues = uniqueSorted([...parent.subIssues, repair.issue]);

  const repaired = {
    ...snapshot,
    issues: [...issues.values()].toSorted(byNumber),
  };
  const repairedValidation = validateNativeRelationshipSnapshot(repaired);
  if (repairedValidation.diagnostics.length > 0) throw relationshipError(repairedValidation);
  return repaired;
}

function relationshipCounts(snapshot) {
  const issues = issueIndex(snapshot);
  const open = openSubIssues(snapshot);
  return {
    openSubIssues: open.length,
    nativeParents: open.filter(issue => issue.parent !== null).length,
    nativeBlockedIssues: open.filter(issue => issue.blockedBy.some(number => issues.get(number)?.state === 'OPEN'))
      .length,
    openBlockerEdges: open.reduce(
      (sum, issue) => sum + issue.blockedBy.filter(number => issues.get(number)?.state === 'OPEN').length,
      0,
    ),
    actionable: computeActionability(snapshot).actionable,
  };
}

export function planProjectionRemoval({ snapshot, audit }) {
  const issue = snapshot.issues.find(candidate => candidate.number === audit.repair.issue);
  if (
    issue?.parent !== audit.repair.parent ||
    !issue.blockedBy.includes(audit.repair.blockedBy) ||
    !snapshot.issues.find(candidate => candidate.number === audit.repair.parent)?.subIssues.includes(audit.repair.issue)
  ) {
    return Object.freeze({
      diagnostics: Object.freeze([diagnostic(DIAGNOSTIC.projectionBackfill)]),
      plan: null,
    });
  }

  const measured = relationshipCounts(snapshot);
  if (JSON.stringify(measured) !== JSON.stringify(audit.repair.liveExpected)) {
    return Object.freeze({
      diagnostics: Object.freeze([diagnostic(DIAGNOSTIC.projectionParity)]),
      plan: null,
    });
  }
  return Object.freeze({
    diagnostics: Object.freeze([]),
    plan: Object.freeze({
      labels: audit.afterClosing733.blockedLabelCount,
      affectedBodies: audit.afterClosing733.parenthesizedProjections.bodyCounts.total,
      parenthesizedOccurrences: audit.afterClosing733.parenthesizedProjections.occurrenceCounts.total,
      checklistSuffixes: audit.afterClosing733.parenthesizedProjections.checklistSuffixCounts.total,
      openBlockerProseBodies: audit.baseline.broaderBlockedByProse.open,
      retainClosedHistoricalNarrative: true,
    }),
  });
}

function ghJson(repository, path, page) {
  const separator = path.includes('?') ? '&' : '?';
  const endpoint = `repos/${repository}/${path}${separator}per_page=${String(ISSUE_PAGE_SIZE)}&page=${String(page)}`;
  const output = execFileSync('gh', ['api', endpoint], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed)) throw new Error(`GitHub returned a non-array response for ${endpoint}`);
  return parsed;
}

function ghIssue(repository, number) {
  const endpoint = `repos/${repository}/issues/${String(number)}`;
  const output = execFileSync('gh', ['api', endpoint], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const parsed = JSON.parse(output);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`GitHub returned a non-object response for ${endpoint}`);
  }
  return parsed;
}

function nextPage(rows, page) {
  return rows.length === ISSUE_PAGE_SIZE ? page + 1 : null;
}

function issueNumberFromUrl(url) {
  if (url === null || url === undefined) return null;
  const match = String(url).match(/\/issues\/(\d+)$/);
  if (match === null) throw new Error(`GitHub returned an invalid parent_issue_url "${String(url)}"`);
  return Number(match[1]);
}

function githubIssueRow(issue) {
  const parent = issueNumberFromUrl(issue.parent_issue_url);
  return {
    number: issue.number,
    state: issue.state,
    title: issue.title,
    labels: issue.labels,
    parent,
    isSubIssue: parent !== null,
    relationshipReads: {
      subIssues: issue.state === 'open' && (issue.sub_issues_summary?.total ?? 0) > 0,
      blockedBy: issue.state === 'open' && (issue.issue_dependencies_summary?.total_blocked_by ?? 0) > 0,
    },
  };
}

function githubSource(repository) {
  return {
    async listIssues(page) {
      const rows = ghJson(repository, 'issues?state=open', page);
      return {
        items: rows.filter(issue => issue.pull_request === undefined).map(githubIssueRow),
        nextPage: nextPage(rows, page),
      };
    },
    async getIssue(number) {
      return githubIssueRow(ghIssue(repository, number));
    },
    async listSubIssues(issue, page) {
      const rows = ghJson(repository, `issues/${String(issue)}/sub_issues?`, page);
      return { items: rows.map(githubIssueRow), nextPage: nextPage(rows, page) };
    },
    async listBlockedBy(issue, page) {
      const rows = ghJson(repository, `issues/${String(issue)}/dependencies/blocked_by?`, page);
      return { items: rows.map(githubIssueRow), nextPage: nextPage(rows, page) };
    },
  };
}

export async function readGitHubNativeRelationshipSnapshot({ repository }) {
  return readNativeRelationshipSnapshot({
    repository,
    capturedAt: new Date().toISOString(),
    source: githubSource(repository),
  });
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write('usage: node scripts/roadmap/native-relationships.mjs [--repository owner/repo] [--json]\n');
    return;
  }
  let repository = process.env.ROADMAP_REPO ?? 'ambasta/zmdb';
  let json = false;
  const arguments_ = process.argv.slice(2);
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index];
    if (argument === '--repository') {
      repository = arguments_[++index];
    } else if (argument === '--json') {
      json = true;
    } else {
      throw new Error('usage: node scripts/roadmap/native-relationships.mjs [--repository owner/repo] [--json]');
    }
  }
  if (typeof repository !== 'string' || repository.length === 0) {
    throw new Error('usage: node scripts/roadmap/native-relationships.mjs [--repository owner/repo] [--json]');
  }
  const snapshot = await readGitHubNativeRelationshipSnapshot({ repository });
  process.stdout.write(json ? `${JSON.stringify(snapshot, undefined, 2)}\n` : renderActionabilityReport(snapshot));
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
