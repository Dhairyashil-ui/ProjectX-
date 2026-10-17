import assert from 'node:assert/strict';
import {
  parseAndValidateRepo,
  parseRepoIdentifier,
  getCommitsApiUrl,
  getRepoMetaApiUrl,
  getReleasesApiUrl,
  getTagsApiUrl,
  getCommitDetailsApiUrl,
  getTreeApiUrl,
  handleApiError,
  fetchRealRepositoryTimeline,
  GitHubApiError,
} from '../src/services/githubTimelineService.js';

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

console.log('\n--- GitStory Repository Validation & URL Generator Test Suite ---\n');

// 1. VALID REPOSITORY INPUTS
console.log('1. Valid Repository Inputs:');
test('accepts standard "owner/repo" format (facebook/react)', () => {
  const res = parseAndValidateRepo('facebook/react');
  assert.equal(res.isValid, true);
  assert.equal(res.owner, 'facebook');
  assert.equal(res.repo, 'react');
  assert.equal(res.fullName, 'facebook/react');
  assert.equal(res.error, null);
});

test('accepts full https GitHub URL (https://github.com/facebook/react)', () => {
  const res = parseAndValidateRepo('https://github.com/facebook/react');
  assert.equal(res.isValid, true);
  assert.equal(res.owner, 'facebook');
  assert.equal(res.repo, 'react');
  assert.equal(res.fullName, 'facebook/react');
});

test('accepts https GitHub URL with trailing slash (https://github.com/facebook/react/)', () => {
  const res = parseAndValidateRepo('https://github.com/facebook/react/');
  assert.equal(res.isValid, true);
  assert.equal(res.owner, 'facebook');
  assert.equal(res.repo, 'react');
  assert.equal(res.fullName, 'facebook/react');
});

test('accepts http GitHub URL (http://github.com/facebook/react)', () => {
  const res = parseAndValidateRepo('http://github.com/facebook/react');
  assert.equal(res.isValid, true);
  assert.equal(res.owner, 'facebook');
  assert.equal(res.repo, 'react');
});

test('accepts git clone URL with .git suffix (https://github.com/facebook/react.git)', () => {
  const res = parseAndValidateRepo('https://github.com/facebook/react.git');
  assert.equal(res.isValid, true);
  assert.equal(res.owner, 'facebook');
  assert.equal(res.repo, 'react');
});

test('accepts SSH clone URL (git@github.com:facebook/react.git)', () => {
  const res = parseAndValidateRepo('git@github.com:facebook/react.git');
  assert.equal(res.isValid, true);
  assert.equal(res.owner, 'facebook');
  assert.equal(res.repo, 'react');
});

test('accepts GitHub URL with query params (https://github.com/facebook/react?tab=readme)', () => {
  const res = parseAndValidateRepo('https://github.com/facebook/react?tab=readme');
  assert.equal(res.isValid, true);
  assert.equal(res.owner, 'facebook');
  assert.equal(res.repo, 'react');
});

test('accepts GitHub URL with hash anchor (https://github.com/facebook/react#readme)', () => {
  const res = parseAndValidateRepo('https://github.com/facebook/react#readme');
  assert.equal(res.isValid, true);
  assert.equal(res.owner, 'facebook');
  assert.equal(res.repo, 'react');
});

test('accepts GitHub URL with tree subpath (https://github.com/facebook/react/tree/main)', () => {
  const res = parseAndValidateRepo('https://github.com/facebook/react/tree/main');
  assert.equal(res.isValid, true);
  assert.equal(res.owner, 'facebook');
  assert.equal(res.repo, 'react');
});

test('accepts usernames with hyphens and repos with dots (Dhairyashil-ui/KrushiMitra-Backend, vercel/next.js)', () => {
  const res1 = parseAndValidateRepo('Dhairyashil-ui/KrushiMitra-Backend');
  assert.equal(res1.isValid, true);
  assert.equal(res1.owner, 'Dhairyashil-ui');
  assert.equal(res1.repo, 'KrushiMitra-Backend');

  const res2 = parseAndValidateRepo('vercel/next.js');
  assert.equal(res2.isValid, true);
  assert.equal(res2.owner, 'vercel');
  assert.equal(res2.repo, 'next.js');
});

// 2. MALFORMED REPOSITORY INPUTS & PROMPT TEXT
console.log('\n2. Malformed Repository Inputs & Prompt Text Rejection:');
test('rejects arbitrary instruction text ("the line which is selected...")', () => {
  const res = parseAndValidateRepo('the line which is selected as date changes');
  assert.equal(res.isValid, false);
  assert.equal(res.owner, null);
  assert.equal(res.repo, null);
  assert.match(res.error, /Invalid repository format/);
});

test('rejects full prompt instruction strings', () => {
  const res = parseAndValidateRepo('Design a premium, minimalist GitStory Time-Travel Timeline UI');
  assert.equal(res.isValid, false);
  assert.equal(res.owner, null);
  assert.equal(res.repo, null);
});

test('rejects single owner without repo ("facebook")', () => {
  const res = parseAndValidateRepo('facebook');
  assert.equal(res.isValid, false);
  assert.equal(res.owner, null);
  assert.equal(res.repo, null);
});

test('rejects trailing slash without repo name ("facebook/")', () => {
  const res = parseAndValidateRepo('facebook/');
  assert.equal(res.isValid, false);
});

test('rejects leading slash without owner ("/react")', () => {
  const res = parseAndValidateRepo('/react');
  assert.equal(res.isValid, false);
});

test('rejects empty string and whitespace', () => {
  const res1 = parseAndValidateRepo('');
  assert.equal(res1.isValid, false);
  const res2 = parseAndValidateRepo('   ');
  assert.equal(res2.isValid, false);
  const res3 = parseAndValidateRepo(null);
  assert.equal(res3.isValid, false);
});

test('rejects names with spaces or illegal characters ("facebook/react with spaces")', () => {
  const res = parseAndValidateRepo('facebook/react with spaces');
  assert.equal(res.isValid, false);
  assert.match(res.error, /Invalid repository or owner name/);
});

test('rejects non-GitHub URLs ("https://gitlab.com/owner/repo")', () => {
  const res = parseAndValidateRepo('https://gitlab.com/owner/repo');
  assert.equal(res.isValid, false);
  assert.match(res.error, /Only GitHub repositories are supported/);
});

// 3. SAFE PARSER FALLBACK
console.log('\n3. Safe Parser Fallback (parseRepoIdentifier):');
test('parseRepoIdentifier returns facebook/react on valid input', () => {
  const res = parseRepoIdentifier('facebook/react');
  assert.equal(res.owner, 'facebook');
  assert.equal(res.repo, 'react');
  assert.equal(res.isValid, true);
});

test('parseRepoIdentifier NEVER uses prompt text as repo name', () => {
  const res = parseRepoIdentifier('the line which is selected...');
  assert.notEqual(res.repo, 'the line which is selected...');
  assert.equal(res.owner, 'facebook');
  assert.equal(res.repo, 'react');
  assert.equal(res.isValid, false);
});

test('parseRepoIdentifier safely handles empty/null input', () => {
  const res1 = parseRepoIdentifier('');
  assert.equal(res1.owner, 'facebook');
  assert.equal(res1.repo, 'react');
  const res2 = parseRepoIdentifier(null);
  assert.equal(res2.owner, 'facebook');
  assert.equal(res2.repo, 'react');
});

// 4. EXACT API URL CONSTRUCTION
console.log('\n4. Exact API URL Generation & Path Segment Encoding:');
test('generates exact commits API URL: https://api.github.com/repos/facebook/react/commits?per_page=100', () => {
  const url = getCommitsApiUrl('facebook', 'react');
  assert.equal(url, 'https://api.github.com/repos/facebook/react/commits?per_page=100');
});

test('generates exact repository metadata API URL: https://api.github.com/repos/facebook/react', () => {
  const url = getRepoMetaApiUrl('facebook', 'react');
  assert.equal(url, 'https://api.github.com/repos/facebook/react');
});

test('generates exact releases API URL: https://api.github.com/repos/facebook/react/releases?per_page=30', () => {
  const url = getReleasesApiUrl('facebook', 'react');
  assert.equal(url, 'https://api.github.com/repos/facebook/react/releases?per_page=30');
});

test('generates exact tags API URL: https://api.github.com/repos/facebook/react/tags?per_page=30', () => {
  const url = getTagsApiUrl('facebook', 'react');
  assert.equal(url, 'https://api.github.com/repos/facebook/react/tags?per_page=30');
});

test('generates exact commit details API URL: https://api.github.com/repos/facebook/react/commits/8a307c1', () => {
  const url = getCommitDetailsApiUrl('facebook', 'react', '8a307c1');
  assert.equal(url, 'https://api.github.com/repos/facebook/react/commits/8a307c1');
});

test('generates exact tree API URL: https://api.github.com/repos/facebook/react/git/trees/8a307c1?recursive=1', () => {
  const url = getTreeApiUrl('facebook', 'react', '8a307c1');
  assert.equal(url, 'https://api.github.com/repos/facebook/react/git/trees/8a307c1?recursive=1');
});

test('safely URL-encodes special path segments', () => {
  const url = getCommitsApiUrl('my org', 'weird repo');
  assert.equal(url, 'https://api.github.com/repos/my%20org/weird%20repo/commits?per_page=100');
  assert.ok(!url.includes(' '));
});

// 5. PRE-REQUEST VALIDATION REJECTION
console.log('\n5. Pre-Request Validation Rejection:');
await testAsync('fetchRealRepositoryTimeline rejects malformed input without making network call', async () => {
  let thrownError = null;
  try {
    await fetchRealRepositoryTimeline('the line which is selected...');
  } catch (err) {
    thrownError = err;
  }
  assert.ok(thrownError instanceof GitHubApiError, 'Should throw a GitHubApiError');
  assert.equal(thrownError.status, 400);
  assert.equal(thrownError.type, 'VALIDATION');
  assert.match(thrownError.message, /Invalid repository format/);
});

// 6. ERROR CATEGORIZATION (401, 403, 404, etc.)
console.log('\n6. Differentiated Error Handling:');
await testAsync('handleApiError distinguishes 401 Unauthorized', async () => {
  const mockRes = {
    status: 401,
    json: async () => ({ message: 'Bad credentials' }),
  };
  let err = null;
  try {
    await handleApiError(mockRes, 'facebook/react');
  } catch (e) {
    err = e;
  }
  assert.equal(err.status, 401);
  assert.equal(err.type, 'UNAUTHORIZED');
});

await testAsync('handleApiError distinguishes 403 Rate Limit Exceeded', async () => {
  const mockRes = {
    status: 403,
    headers: { get: (name) => (name === 'x-ratelimit-remaining' ? '0' : null) },
    json: async () => ({ message: 'API rate limit exceeded for 127.0.0.1' }),
  };
  let err = null;
  try {
    await handleApiError(mockRes, 'facebook/react');
  } catch (e) {
    err = e;
  }
  assert.equal(err.status, 403);
  assert.equal(err.type, 'RATE_LIMIT');
});

await testAsync('handleApiError distinguishes 404 Not Found', async () => {
  const mockRes = {
    status: 404,
    json: async () => ({ message: 'Not Found' }),
  };
  let err = null;
  try {
    await handleApiError(mockRes, 'facebook/nonexistent-xyz-123');
  } catch (e) {
    err = e;
  }
  assert.equal(err.status, 404);
  assert.equal(err.type, 'NOT_FOUND');
  assert.match(err.message, /404 Not Found/);
});

console.log(`\n========================================`);
console.log(`Test Results: ${passed} passed, ${failed} failed`);
console.log(`========================================\n`);

if (failed > 0) {
  process.exit(1);
}
