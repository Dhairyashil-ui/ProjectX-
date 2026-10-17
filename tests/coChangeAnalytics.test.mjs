import assert from 'node:assert/strict';
import {
  generatePairs,
  calculateJaccardSimilarity,
  extractFilesFromCommit,
  detectChangeClusters,
  filterCoChangeGraph,
} from '../src/services/coChangeAnalyticsService.js';

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

console.log('\n--- GitStory Explore Code & Co-Change Analytics Test Suite ---\n');

// 1. Pair Generation
console.log('1. Pair Generation:');
test('generates all unordered unique pairs for changed files', () => {
  const files = ['a.js', 'b.js', 'c.js'];
  const pairs = generatePairs(files);
  assert.equal(pairs.length, 3);
  assert.deepEqual(pairs, [
    ['a.js', 'b.js'],
    ['a.js', 'c.js'],
    ['b.js', 'c.js'],
  ]);
});

test('returns empty array when fewer than 2 files changed', () => {
  assert.deepEqual(generatePairs(['single.js']), []);
  assert.deepEqual(generatePairs([]), []);
});

// 2. Jaccard Similarity Calculation
console.log('\n2. Jaccard Similarity Score:');
test('calculates correct Jaccard similarity', () => {
  // A has 4 commits, B has 4 commits, shared = 2
  // Union = 4 + 4 - 2 = 6
  // Jaccard = 2 / 6 = 0.333
  const jaccard = calculateJaccardSimilarity(4, 4, 2);
  assert.equal(jaccard, 0.333);
});

test('returns 1.0 when files always change together', () => {
  const jaccard = calculateJaccardSimilarity(5, 5, 5);
  assert.equal(jaccard, 1.0);
});

test('returns 0 when files never change together', () => {
  const jaccard = calculateJaccardSimilarity(5, 3, 0);
  assert.equal(jaccard, 0);
});

// 3. Commit Files Extraction
console.log('\n3. Commit Files Extraction:');
test('extracts and normalizes filenames, directories, and stats from commit', () => {
  const rawDetail = {
    files: [
      {
        filename: 'packages/react/src/React.js',
        status: 'modified',
        additions: 12,
        deletions: 4,
      },
      {
        filename: 'packages/react/src/ReactElement.js',
        status: 'added',
        additions: 45,
        deletions: 0,
      },
    ],
  };

  const files = extractFilesFromCommit(rawDetail);
  assert.equal(files.length, 2);
  assert.equal(files[0].filename, 'packages/react/src/React.js');
  assert.equal(files[0].baseName, 'React.js');
  assert.equal(files[0].directory, 'packages/react/src');
  assert.equal(files[0].status, 'modified');
  assert.equal(files[0].additions, 12);
});

// 4. Community Detection / Change Clustering
console.log('\n4. Community Detection / Change Clusters:');
test('detects meaningful clusters for tightly coupled file groups', () => {
  const nodes = [
    { id: 'packages/react/src/React.js', baseName: 'React.js', directory: 'packages/react/src', uniqueCommits: 5, contributors: ['alice'] },
    { id: 'packages/react/src/ReactElement.js', baseName: 'ReactElement.js', directory: 'packages/react/src', uniqueCommits: 5, contributors: ['alice'] },
    { id: 'packages/react-dom/src/ReactDOM.js', baseName: 'ReactDOM.js', directory: 'packages/react-dom/src', uniqueCommits: 4, contributors: ['bob'] },
    { id: 'packages/react-dom/src/client.js', baseName: 'client.js', directory: 'packages/react-dom/src', uniqueCommits: 4, contributors: ['bob'] },
  ];

  const edges = [
    { source: 'packages/react/src/React.js', target: 'packages/react/src/ReactElement.js', sharedCommits: 4, jaccard: 0.67 },
    { source: 'packages/react-dom/src/ReactDOM.js', target: 'packages/react-dom/src/client.js', sharedCommits: 4, jaccard: 0.67 },
  ];

  const clusters = detectChangeClusters(nodes, edges, 0.2);
  assert.ok(clusters.length >= 1, 'Should detect at least 1 cluster');
  assert.ok(clusters.every((c) => c.size >= 2), 'Clusters must have 2 or more files');
});

// 5. Dynamic Filtering
console.log('\n5. Dynamic Filtering:');
test('filters nodes and edges by directory and search query', () => {
  const mockGraph = {
    nodes: [
      { id: 'src/core/index.js', filename: 'src/core/index.js', baseName: 'index.js', directory: 'src/core', uniqueCommits: 3 },
      { id: 'src/core/utils.js', filename: 'src/core/utils.js', baseName: 'utils.js', directory: 'src/core', uniqueCommits: 3 },
      { id: 'tests/test.js', filename: 'tests/test.js', baseName: 'test.js', directory: 'tests', uniqueCommits: 1 },
    ],
    edges: [
      { source: 'src/core/index.js', target: 'src/core/utils.js', sharedCommits: 2, jaccard: 0.5 },
      { source: 'src/core/index.js', target: 'tests/test.js', sharedCommits: 1, jaccard: 0.33 },
    ],
    clusters: [],
  };

  const filtered = filterCoChangeGraph(mockGraph, {
    directory: 'src/core',
    minSharedCommits: 2,
  });

  assert.equal(filtered.filteredNodesCount, 2);
  assert.equal(filtered.filteredEdgesCount, 1);
  assert.equal(filtered.edges[0].source, 'src/core/index.js');
  assert.equal(filtered.edges[0].target, 'src/core/utils.js');
});

console.log(`\n========================================`);
console.log(`Co-Change Test Results: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
}
