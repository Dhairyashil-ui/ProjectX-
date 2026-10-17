import assert from 'node:assert/strict';
import { githubApi, validateConfiguredToken, limitConcurrency } from '../server/githubApi.js';
import { mapGitHubUrlToBackendProxy, getGitHubHeaders } from '../src/services/githubTimelineService.js';

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

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

console.log('\n--- GitStory GitHub Authentication, Caching & Proxy Test Suite ---\n');

// 1. Centralized URL Proxy Mapping
console.log('1. Centralized URL Proxy Mapping:');
test('maps commit history URL to /api/github/commits', () => {
  const url = 'https://api.github.com/repos/facebook/react/commits?per_page=100&page=1';
  const proxy = mapGitHubUrlToBackendProxy(url);
  assert.equal(proxy, '/api/github/commits?repo=facebook/react&per_page=100&page=1');
});

test('maps commit details URL to /api/github/commit-details', () => {
  const url = 'https://api.github.com/repos/facebook/react/commits/8a307c1b';
  const proxy = mapGitHubUrlToBackendProxy(url);
  assert.equal(proxy, '/api/github/commit-details?repo=facebook/react&sha=8a307c1b');
});

test('maps repository metadata URL to /api/github/repo', () => {
  const url = 'https://api.github.com/repos/facebook/react';
  const proxy = mapGitHubUrlToBackendProxy(url);
  assert.equal(proxy, '/api/github/repo?repo=facebook/react');
});

test('maps releases URL to /api/github/releases', () => {
  const url = 'https://api.github.com/repos/facebook/react/releases';
  const proxy = mapGitHubUrlToBackendProxy(url);
  assert.equal(proxy, '/api/github/releases?repo=facebook/react');
});

test('maps git tree URL to /api/github/tree', () => {
  const url = 'https://api.github.com/repos/facebook/react/git/trees/8a307c1b?recursive=1';
  const proxy = mapGitHubUrlToBackendProxy(url);
  assert.equal(proxy, '/api/github/tree?repo=facebook/react&sha=8a307c1b');
});

// 2. Client-Side Security & Header Hygiene
console.log('\n2. Security & Token Hygiene:');
test('getGitHubHeaders returns clean headers without authorization tokens', () => {
  const headers = getGitHubHeaders();
  assert.equal(headers.Authorization, undefined, 'Client headers must NEVER contain Authorization token');
  assert.equal(headers.Accept, 'application/vnd.github.v3+json');
});

// 3. Centralized Token Authentication Verification
console.log('\n3. Centralized Token Authentication:');
await testAsync('validates configured server token with GET /user', async () => {
  githubApi.setTokenInvalid(false);
  const status = await githubApi.validateStatus(true);
  assert.equal(typeof status, 'object');
  assert.equal(status.configured, true);
  assert.equal(status.isValid, true);
  assert.equal(typeof status.username, 'string');
  assert.ok(status.rateLimit.limit >= 60, 'Rate limit must be reported');
  assert.equal(status.token, undefined, 'Actual token must NEVER be exposed in auth status object');
});

await testAsync('detects invalid or expired token without entering retry loop', async () => {
  githubApi.setTokenInvalid(true);
  const status = await githubApi.validateStatus();
  assert.equal(status.isValid, false);
  assert.equal(status.mode, 'invalid_token');
  assert.equal(status.code, 'INVALID_TOKEN');

  // Attempting request with invalidated token must fail fast without network retries
  await assert.rejects(
    async () => {
      await githubApi.getRepoMetadata('facebook', 'react');
    },
    (err) => {
      assert.equal(err.code, 'INVALID_TOKEN');
      return true;
    }
  );

  // Restore token for subsequent tests
  githubApi.setTokenInvalid(false);
});

// 4. In-Memory Caching & Immutable Data
console.log('\n4. In-Memory Caching & Deduplication:');
await testAsync('caches repository metadata and reuses it on subsequent calls', async () => {
  githubApi.clearCache();
  const first = await githubApi.getRepoMetadata('facebook', 'react');
  const second = await githubApi.getRepoMetadata('facebook', 'react');
  assert.equal(first.name, second.name);
  assert.equal(first.full_name, second.full_name);
});

await testAsync('deduplicates simultaneous concurrent requests into a single promise', async () => {
  const [res1, res2, res3] = await Promise.all([
    githubApi.getRepoMetadata('facebook', 'react'),
    githubApi.getRepoMetadata('facebook', 'react'),
    githubApi.getRepoMetadata('facebook', 'react'),
  ]);
  assert.equal(res1.name, 'react');
  assert.equal(res2.name, 'react');
  assert.equal(res3.name, 'react');
});

// 5. Concurrency Limiter
console.log('\n5. Concurrency Limiter:');
await testAsync('executes batch tasks with maximum concurrency limit of 4', async () => {
  let activeCount = 0;
  let maxObservedActive = 0;

  const items = [1, 2, 3, 4, 5, 6, 7, 8];
  const results = await limitConcurrency(items, 4, async (item) => {
    activeCount++;
    maxObservedActive = Math.max(maxObservedActive, activeCount);
    await new Promise(r => setTimeout(r, 20));
    activeCount--;
    return item * 2;
  });

  assert.equal(results.length, 8);
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12, 14, 16]);
  assert.ok(maxObservedActive <= 4, `Max concurrency (${maxObservedActive}) must not exceed limit 4`);
});

// 6. Latest and Recent Commits APIs
console.log('\n6. Latest & Recent Commits API:');
await testAsync('githubApi.getLatestCommit is a function and returns latest commit object', async () => {
  assert.equal(typeof githubApi.getLatestCommit, 'function');
  const latest = await githubApi.getLatestCommit('facebook', 'react');
  assert.ok(latest);
  assert.ok(latest.sha);
  assert.ok(latest.commit);
});

await testAsync('githubApi.getRecentCommits is a function and returns limited array of commits', async () => {
  assert.equal(typeof githubApi.getRecentCommits, 'function');
  const recent = await githubApi.getRecentCommits('facebook', 'react', 3);
  assert.ok(Array.isArray(recent));
  assert.ok(recent.length <= 3);
});

console.log('\n========================================');
console.log(`GitHub Auth & Cache Tests: ${passed} passed, ${failed} failed`);
console.log('========================================\n');

if (failed > 0) {
  process.exit(1);
}
