import assert from 'node:assert/strict';
import test from 'node:test';
import { authoredBy, mergedForkContributions } from './merged-fork-contributions.mjs';

test('counts only authored commits from a merged fork PR, including squash source commits', async () => {
  const own = { sha: 'source-sha', author: { login: 'me' }, commit: { author: { date: '2026-10-01T00:00:00Z' } } };
  const other = { sha: 'other-sha', author: { login: 'someone-else' }, commit: { author: { date: '2026-10-01T00:00:00Z' } } };
  const fetch = async url => {
    if (url.includes('/search/issues')) return { total_count: 1, items: [{ pull_request: { url: 'https://api.github.com/pull/1' } }] };
    if (url.endsWith('/pull/1')) return {
      number: 1, commits: 2, changed_files: 1, merged_at: '2026-10-02T00:00:00Z', merge_commit_sha: 'squash-sha',
      head: { repo: { fork: true, owner: { login: 'me' } } }, base: { repo: { full_name: 'upstream/project' } },
    };
    if (url.includes('/pulls/1/files')) return [{ filename: 'src/index.ts' }];
    if (url.includes('/pulls/1/commits')) return [own, other];
    if (url.endsWith('/commits/source-sha')) return { files: [{ filename: 'src/index.ts', changes: 7 }] };
    throw new Error(`Unexpected URL: ${url}`);
  };
  const result = await mergedForkContributions({ githubFetch: fetch, username: 'me', since: '2026-09-01T00:00:00Z', matchesAuthor: commit => commit.author?.login === 'me' });
  assert.deepEqual(result, [{ repo: { full_name: 'upstream/project' }, sha: 'source-sha', files: [{ filename: 'src/index.ts', changes: 7 }], pullNumber: 1 }]);
});

test('excludes unmerged and same-repository PRs', async () => {
  const prs = [
    { merged_at: null, head: { repo: { fork: true, owner: { login: 'me' } } } },
    { merged_at: '2026-10-02T00:00:00Z', head: { repo: { fork: false, owner: { login: 'me' } } } },
  ];
  let index = 0;
  const fetch = async url => url.includes('/search/issues')
    ? { total_count: 2, items: prs.map((_, i) => ({ pull_request: { url: `https://api.github.com/pull/${i}` } })) }
    : prs[index++];
  const result = await mergedForkContributions({ githubFetch: fetch, username: 'me', since: '2026-09-01T00:00:00Z', matchesAuthor: () => true });
  assert.deepEqual(result, []);
});

test('does not treat another author as a contribution just because the user committed it', () => {
  const authors = new Set(['me']);
  assert.equal(authoredBy({ author: { login: 'other' }, committer: { login: 'me' }, commit: { author: { name: 'other' } } }, authors), false);
});

test('drops an authored file removed from the final merged PR diff', async () => {
  const fetch = async url => {
    if (url.includes('/search/issues')) return { total_count: 1, items: [{ pull_request: { url: 'https://api.github.com/pull/2' } }] };
    if (url.endsWith('/pull/2')) return {
      number: 2, commits: 1, changed_files: 1, merged_at: '2026-10-02T00:00:00Z',
      head: { repo: { fork: true, owner: { login: 'me' } } }, base: { repo: { full_name: 'upstream/project' } },
    };
    if (url.includes('/pulls/2/files')) return [{ filename: 'src/kept.ts' }];
    if (url.includes('/pulls/2/commits')) return [{ sha: 'original', author: { login: 'me' }, commit: { author: { date: '2026-10-01T00:00:00Z' } } }];
    if (url.endsWith('/commits/original')) return { files: [{ filename: 'src/reverted.ts', changes: 5 }] };
    throw new Error(`Unexpected URL: ${url}`);
  };
  const result = await mergedForkContributions({ githubFetch: fetch, username: 'me', since: '2026-09-01T00:00:00Z', matchesAuthor: commit => commit.author?.login === 'me' });
  assert.deepEqual(result, []);
});
