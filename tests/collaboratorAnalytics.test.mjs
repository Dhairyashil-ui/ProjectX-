import assert from 'node:assert/strict';
import {
  normalizeContributorIdentity,
  parseFilePath,
  calculateConcentration,
  getBucketKey,
  filterCollaboratorAnalytics,
} from '../src/services/collaboratorAnalyticsService.js';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log('\n--- GitStory Collaborators Analytics Test Suite ---\n');

// 1. Identity Normalization & Bot Detection
console.log('1. Contributor Identity Normalization & Bot Detection:');
test('normalizes GitHub user with author login and avatar', () => {
  const raw = {
    author: {
      login: 'sophiebits',
      avatar_url: 'https://avatars.githubusercontent.com/u/99?v=4',
      html_url: 'https://github.com/sophiebits',
    },
    commit: {
      author: { name: 'Sophie Alpert', email: 'sophie@fb.com', date: '2016-04-01T00:00:00Z' },
    },
  };
  const res = normalizeContributorIdentity(raw);
  assert.equal(res.login, 'sophiebits');
  assert.equal(res.name, 'Sophie Alpert');
  assert.equal(res.isBot, false);
  assert.equal(res.htmlUrl, 'https://github.com/sophiebits');
});

test('detects dependabot and github-actions bots', () => {
  const botCommit1 = {
    author: { login: 'dependabot[bot]', type: 'Bot' },
    commit: { author: { name: 'dependabot[bot]', email: 'bot@github.com' } },
  };
  const res1 = normalizeContributorIdentity(botCommit1);
  assert.equal(res1.isBot, true);

  const botCommit2 = {
    author: { login: 'github-actions[bot]' },
    commit: { author: { name: 'github-actions[bot]', email: 'actions@github.com' } },
  };
  const res2 = normalizeContributorIdentity(botCommit2);
  assert.equal(res2.isBot, true);
});

test('handles commit with missing author object, falling back to git email', () => {
  const raw = {
    commit: {
      author: { name: 'Dan Abramov', email: 'dan@gaearon.com' },
    },
  };
  const res = normalizeContributorIdentity(raw);
  assert.equal(res.name, 'Dan Abramov');
  assert.equal(res.login, 'dan');
  assert.equal(res.isBot, false);
});

// 2. Directory Hierarchy Extraction
console.log('\n2. File Path & Directory Hierarchy Extraction:');
test('parses nested file path into directory and all ancestors', () => {
  const path = 'packages/react-dom/src/client/ReactDOM.js';
  const res = parseFilePath(path);
  assert.equal(res.filename, 'ReactDOM.js');
  assert.equal(res.fullDir, 'packages/react-dom/src/client');
  assert.deepEqual(res.ancestors, [
    'packages',
    'packages/react-dom',
    'packages/react-dom/src',
    'packages/react-dom/src/client',
  ]);
});

test('handles root level file cleanly', () => {
  const path = 'README.md';
  const res = parseFilePath(path);
  assert.equal(res.filename, 'README.md');
  assert.equal(res.fullDir, '(root)');
  assert.deepEqual(res.ancestors, ['(root)']);
});

// 3. Contribution Concentration & Knowledge Silo Scoring
console.log('\n3. Contribution Concentration (HHI & Share):');
test('identifies high concentration when one author dominates (>= 70%)', () => {
  const counts = [
    { contributorId: 'gaearon', count: 18 },
    { contributorId: 'acdlite', count: 2 },
  ];
  const res = calculateConcentration(counts);
  assert.equal(res.totalCommits, 20);
  assert.equal(res.topContributorId, 'gaearon');
  assert.equal(res.topContributorSharePct, 90.0);
  assert.equal(res.riskLevel, 'high');
});

test('identifies distributed activity when contributions are shared', () => {
  const counts = [
    { contributorId: 'alice', count: 5 },
    { contributorId: 'bob', count: 4 },
    { contributorId: 'charlie', count: 4 },
    { contributorId: 'david', count: 3 },
  ];
  const res = calculateConcentration(counts);
  assert.equal(res.totalCommits, 16);
  assert.equal(res.riskLevel, 'low');
  assert.ok(res.topContributorSharePct < 45);
});

// 4. Time Bucketing
console.log('\n4. Time Bucketing (Day / Week / Month):');
test('buckets ISO dates into correct day, week, and month keys', () => {
  const dateStr = '2024-03-15T10:30:00Z';
  assert.equal(getBucketKey(dateStr, 'day'), '2024-03-15');
  assert.equal(getBucketKey(dateStr, 'month'), '2024-03');
  assert.match(getBucketKey(dateStr, 'week'), /^2024-W\d{2}$/);
});

// 5. Dynamic Filtering
console.log('\n5. Dynamic Filtering:');
test('filters dataset by contributor, hiding other authors', () => {
  const mockData = {
    commits: [
      {
        sha: 'c1',
        date: '2024-01-01T00:00:00Z',
        timestamp: new Date('2024-01-01T00:00:00Z').getTime(),
        author: { id: 'alice', login: 'alice', isBot: false },
        isMerge: false,
        additions: 10,
        deletions: 2,
        touchedDirectories: ['src/core'],
        files: [],
      },
      {
        sha: 'c2',
        date: '2024-01-05T00:00:00Z',
        timestamp: new Date('2024-01-05T00:00:00Z').getTime(),
        author: { id: 'bob', login: 'bob', isBot: false },
        isMerge: false,
        additions: 20,
        deletions: 5,
        touchedDirectories: ['src/dom'],
        files: [],
      },
    ],
  };

  const filtered = filterCollaboratorAnalytics(mockData, {
    selectedContributorId: 'alice',
  });

  assert.equal(filtered.filteredCommitsCount, 1);
  assert.equal(filtered.contributors.length, 1);
  assert.equal(filtered.contributors[0].login, 'alice');
});

console.log(`\n========================================`);
console.log(`Collaborator Test Results: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
}
