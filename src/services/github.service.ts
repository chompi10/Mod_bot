import { Octokit } from "@octokit/rest";

export interface GitHubConfig {
  token: string;
}

export interface Repository {
  name: string;
  fullName: string;
  description: string | null;
  url: string;
  language: string | null;
  stars: number;
  forks: number;
}

export interface Issue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  url: string;
  labels: string[];
  createdAt: Date;
}

export interface PullRequest {
  number: number;
  title: string;
  head: string;
  base: string;
  state: string;
  merged: boolean;
  url: string;
  additions: number;
  deletions: number;
}

export interface Commit {
  sha: string;
  message: string;
  author: string;
  date: Date;
  url: string;
}

export interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  branch: string;
  url: string;
  createdAt: Date;
}

export class GitHubService {
  private octokit: Octokit;

  constructor(config: GitHubConfig) {
    this.octokit = new Octokit({
      auth: config.token,
    });
  }

  // ─── Issues ───────────────────────────────────────────────────

  async createIssue(
    owner: string,
    repo: string,
    title: string,
    body?: string,
    labels?: string[]
  ): Promise<Issue> {
    const { data } = await this.octokit.issues.create({
      owner,
      repo,
      title,
      body: body || '',
      labels: labels || [],
    });

    return {
      number: data.number,
      title: data.title,
      body: data.body ?? null,
      state: data.state,
      url: data.html_url,
      labels: data.labels.map((l: any) =>
        typeof l === 'string' ? l : l.name || ''
      ),
      createdAt: new Date(data.created_at),
    };
  }

  async listIssues(
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all' = 'open',
    limit: number = 10
  ): Promise<Issue[]> {
    const { data } = await this.octokit.issues.listForRepo({
      owner,
      repo,
      state,
      per_page: limit,
    });

    return data.map((issue: any) => ({
      number: issue.number,
      title: issue.title,
      body: issue.body ?? null,
      state: issue.state,
      url: issue.html_url,
      labels: issue.labels.map((l: any) =>
        typeof l === 'string' ? l : l.name || ''
      ),
      createdAt: new Date(issue.created_at),
    }));
  }

  async closeIssue(
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<void> {
    await this.octokit.issues.update({
      owner,
      repo,
      issue_number: issueNumber,
      state: 'closed',
    });
  }

  // ─── Pull Requests ────────────────────────────────────────────

  async createPullRequest(
    owner: string,
    repo: string,
    title: string,
    head: string,
    base: string,
    body?: string
  ): Promise<PullRequest> {
    const { data } = await this.octokit.pulls.create({
      owner,
      repo,
      title,
      head,
      base,
      body: body || '',
    });

    return {
      number: data.number,
      title: data.title,
      head: data.head.ref,
      base: data.base.ref,
      state: data.state,
      merged: data.merged,
      url: data.html_url,
      additions: data.additions,
      deletions: data.deletions,
    };
  }

  async listPullRequests(
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all' = 'open',
    limit: number = 10
  ): Promise<PullRequest[]> {
    const { data } = await this.octokit.pulls.list({
      owner,
      repo,
      state,
      per_page: limit,
    });

    return data.map((pr: any) => ({
      number: pr.number,
      title: pr.title,
      head: pr.head.ref,
      base: pr.base.ref,
      state: pr.state,
      merged: pr.merged,
      url: pr.html_url,
      additions: pr.additions ?? 0,
      deletions: pr.deletions ?? 0,
    }));
  }

  async mergePullRequest(
    owner: string,
    repo: string,
    pullNumber: number,
    mergeMethod: 'merge' | 'squash' | 'rebase' = 'merge'
  ): Promise<void> {
    await this.octokit.pulls.merge({
      owner,
      repo,
      pull_number: pullNumber,
      merge_method: mergeMethod,
    });
  }

  // ─── Repositories ─────────────────────────────────────────────

  async getUserRepos(limit: number = 10): Promise<Repository[]> {
    const { data } = await this.octokit.repos.listForAuthenticatedUser({
      sort: 'updated',
      per_page: limit,
    });

    return data.map((repo: any) => ({
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description ?? null,
      url: repo.html_url,
      language: repo.language ?? null,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
    }));
  }

  // ─── Commits ──────────────────────────────────────────────────

  async getCommits(
    owner: string,
    repo: string,
    branch: string = 'main',
    limit: number = 10
  ): Promise<Commit[]> {
    const { data } = await this.octokit.repos.listCommits({
      owner,
      repo,
      sha: branch,
      per_page: limit,
    });

    return data.map((commit: any) => ({
      sha: commit.sha,
      message: commit.commit.message,
      author: commit.commit.author?.name || commit.author?.login || 'Unknown',
      date: new Date(commit.commit.author?.date || ''),
      url: commit.html_url,
    }));
  }

  // ─── Workflows ────────────────────────────────────────────────

  async getWorkflowRuns(
    owner: string,
    repo: string,
    limit: number = 5
  ): Promise<WorkflowRun[]> {
    const { data } = await this.octokit.actions.listWorkflowRunsForRepo({
      owner,
      repo,
      per_page: limit,
    });

    return data.workflow_runs.map((run: any) => ({
      id: run.id,
      name: run.name || 'Unnamed Workflow',
      status: run.status,
      conclusion: run.conclusion,
      branch: run.head_branch || 'unknown',
      url: run.html_url,
      createdAt: new Date(run.created_at),
    }));
  }
}
