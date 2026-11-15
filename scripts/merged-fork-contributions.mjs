/**
 * Find authored commits from the user's forks that reached an upstream repository
 * through a merged pull request. Inspect the PR's original commits so squash merges
 * still identify the author's changes.
 */
export function authoredBy(commit, authors) {
  return [commit.author?.login, commit.commit?.author?.name, commit.commit?.author?.email]
    .filter(Boolean).some(value => authors.has(String(value).toLowerCase()));
}

export async function mergedForkContributions({ githubFetch, username, since, matchesAuthor, seenShas = new Set() }) {
  const query = `is:pr is:merged author:${username} merged:>=${since.slice(0, 10)} -user:${username}`;
  const issues = [];

  for (let page = 1; ; page++) {
    const search = new URL('https://api.github.com/search/issues');
    search.searchParams.set('q', query);
    search.searchParams.set('per_page', '100');
    search.searchParams.set('page', String(page));
    const result = await githubFetch(search.toString());
    if (result.total_count > 1000) throw new Error('Merged PR search exceeds GitHub\'s 1000-result limit');
    issues.push(...result.items);
    if (issues.length >= result.total_count || result.items.length < 100) break;
  }

  const contributions = [];
  for (const issue of issues) {
    const pr = await githubFetch(issue.pull_request.url);
    const headOwner = pr.head.repo?.owner?.login?.toLowerCase();
    const fromUserFork = (pr.head.repo?.fork && headOwner === username.toLowerCase()) ||
      (!pr.head.repo && pr.head.label?.toLowerCase().startsWith(`${username.toLowerCase()}:`));
    if (!pr.merged_at || pr.merged_at < since || !fromUserFork || !pr.base.repo?.full_name) continue;
    if (pr.commits > 250) throw new Error(`Merged PR has more than 250 commits: ${pr.html_url}`);
    if (pr.changed_files > 3000) throw new Error(`Merged PR has more than 3000 files: ${pr.html_url}`);

    const mergedPaths = new Set();
    for (let page = 1; ; page++) {
      const url = new URL(`https://api.github.com/repos/${pr.base.repo.full_name}/pulls/${pr.number}/files`);
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', String(page));
      const files = await githubFetch(url.toString());
      for (const file of files) {
        mergedPaths.add(file.filename);
        if (file.previous_filename) mergedPaths.add(file.previous_filename);
      }
      if (files.length < 100) break;
    }

    for (let page = 1; ; page++) {
      const url = new URL(`https://api.github.com/repos/${pr.base.repo.full_name}/pulls/${pr.number}/commits`);
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', String(page));
      const commits = await githubFetch(url.toString());
      for (const commit of commits) {
        const authoredAt = commit.commit?.author?.date;
        if (!matchesAuthor(commit) || !authoredAt || authoredAt < since || seenShas.has(commit.sha)) continue;
        const detail = await githubFetch(`https://api.github.com/repos/${pr.base.repo.full_name}/commits/${commit.sha}`);
        const files = (detail.files || []).filter(file => mergedPaths.has(file.filename) || mergedPaths.has(file.previous_filename));
        if (files.length) {
          seenShas.add(commit.sha);
          contributions.push({ repo: pr.base.repo, sha: commit.sha, files, pullNumber: pr.number });
        }
      }
      if (commits.length < 100) break;
    }
  }

  return contributions;
}
