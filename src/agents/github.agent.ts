/**
 * @file agents/github.agent.ts — GitHub Integration Agent
 *
 * WHY: Enables users to manage GitHub repos, issues, PRs, commits,
 * and workflows directly from WhatsApp. Uses intent detection to
 * route natural-language messages to the appropriate GitHub API call.
 *
 * PATTERN: Standalone agent with lazy-initialized GitHubService.
 * Does NOT extend BaseAgent because it uses direct API calls
 * rather than the LLM tool-calling loop.
 */

import { GitHubService } from '../services/github.service.js';
import { detectGitHubIntent, GitHubIntent } from '../utils/github-intent.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('GitHubAgent');

export class GitHubAgent {
  private githubService: GitHubService | null = null;

  /**
   * Initialize GitHub service with user's token
   */
  async initialize(userId: string): Promise<void> {
    const token = await this.getUserGitHubToken(userId);

    if (!token) {
      throw new Error('GitHub not configured. Send "github connect" to set up.');
    }

    this.githubService = new GitHubService({ token });
  }

  /**
   * Main entry point for GitHub agent
   */
  async handle(userId: string, message: string, language: string): Promise<string> {
    // Lazy initialization — only create service when needed
    if (!this.githubService) {
      try {
        await this.initialize(userId);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return `⚠️ ${msg}`;
      }
    }

    // Detect intent
    const intentResult = detectGitHubIntent(message);

    if (!intentResult) {
      return this.getHelpMessage(language);
    }

    // Route to appropriate handler
    switch (intentResult.intent) {
      case GitHubIntent.CREATE_ISSUE:
        return await this.handleCreateIssue(userId, message, intentResult.params);

      case GitHubIntent.LIST_ISSUES:
        return await this.handleListIssues(userId, intentResult.params);

      case GitHubIntent.CLOSE_ISSUE:
        return await this.handleCloseIssue(userId, intentResult.params);

      case GitHubIntent.CREATE_PR:
        return await this.handleCreatePR(userId, intentResult.params);

      case GitHubIntent.LIST_PRS:
        return await this.handleListPRs(userId, intentResult.params);

      case GitHubIntent.MERGE_PR:
        return await this.handleMergePR(userId, intentResult.params);

      case GitHubIntent.LIST_REPOS:
        return await this.handleListRepos(userId);

      case GitHubIntent.VIEW_COMMITS:
        return await this.handleViewCommits(userId, intentResult.params);

      case GitHubIntent.CHECK_WORKFLOWS:
        return await this.handleCheckWorkflows(userId, intentResult.params);

      default:
        return this.getHelpMessage(language);
    }
  }

  private async handleCreateIssue(
    userId: string,
    message: string,
    params: Record<string, any>
  ): Promise<string> {
    if (!params.repo) {
      return '📝 Which repository? Please specify like: "create issue in username/repo"';
    }

    const { title, body } = this.extractIssueDetails(message);
    const [owner, repo] = params.repo.split('/');

    try {
      const issue = await this.githubService!.createIssue(owner, repo, title, body);

      return `✅ Issue Created!\n\n` +
        `📋 #${issue.number} - ${issue.title}\n` +
        `🔗 ${issue.url}\n` +
        `Created at: ${issue.createdAt.toLocaleString()}`;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return `❌ Failed to create issue: ${msg}`;
    }
  }

  private async handleListIssues(
    userId: string,
    params: Record<string, any>
  ): Promise<string> {
    if (!params.repo) {
      return '📝 Which repository? Please specify like: "list issues in username/repo"';
    }

    const [owner, repo] = params.repo.split('/');

    try {
      const issues = await this.githubService!.listIssues(owner, repo, 'open', 5);

      if (issues.length === 0) {
        return `✅ No open issues in ${params.repo}`;
      }

      let response = `📋 Open Issues in ${params.repo}\n\n`;

      for (const issue of issues) {
        response += `#${issue.number} - ${issue.title}\n`;
        response += `🏷️ ${issue.labels.join(', ') || 'No labels'}\n`;
        response += `🔗 ${issue.url}\n\n`;
      }

      return response.trim();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return `❌ Failed to list issues: ${msg}`;
    }
  }

  private async handleCloseIssue(
    userId: string,
    params: Record<string, any>
  ): Promise<string> {
    if (!params.repo || !params.number) {
      return '📝 Please specify: "close issue #123 in username/repo"';
    }

    const [owner, repo] = params.repo.split('/');

    try {
      await this.githubService!.closeIssue(owner, repo, params.number);
      return `✅ Issue #${params.number} closed successfully!`;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return `❌ Failed to close issue: ${msg}`;
    }
  }

  private async handleCreatePR(
    userId: string,
    params: Record<string, any>
  ): Promise<string> {
    if (!params.repo || !params.head || !params.base) {
      return '📝 Please specify: "create PR from feature-branch to main in username/repo"';
    }

    const [owner, repo] = params.repo.split('/');
    const title = `Merge ${params.head} into ${params.base}`;

    try {
      const pr = await this.githubService!.createPullRequest(
        owner,
        repo,
        title,
        params.head,
        params.base
      );

      return `✅ Pull Request Created!\n\n` +
        `🔀 #${pr.number} - ${pr.title}\n` +
        `📊 ${pr.head} → ${pr.base}\n` +
        `🔗 ${pr.url}`;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return `❌ Failed to create PR: ${msg}`;
    }
  }

  private async handleListPRs(
    userId: string,
    params: Record<string, any>
  ): Promise<string> {
    if (!params.repo) {
      return '📝 Which repository?';
    }

    const [owner, repo] = params.repo.split('/');

    try {
      const prs = await this.githubService!.listPullRequests(owner, repo, 'open', 5);

      if (prs.length === 0) {
        return `✅ No open pull requests in ${params.repo}`;
      }

      let response = `🔀 Open Pull Requests\n\n`;

      for (const pr of prs) {
        response += `#${pr.number} - ${pr.title}\n`;
        response += `📊 ${pr.head} → ${pr.base}\n`;
        response += `📈 +${pr.additions} / -${pr.deletions}\n`;
        response += `🔗 ${pr.url}\n\n`;
      }

      return response.trim();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return `❌ Failed to list PRs: ${msg}`;
    }
  }

  private async handleMergePR(
    userId: string,
    params: Record<string, any>
  ): Promise<string> {
    if (!params.repo || !params.number) {
      return '📝 Please specify: "merge PR #123 in username/repo"';
    }

    const [owner, repo] = params.repo.split('/');

    try {
      await this.githubService!.mergePullRequest(owner, repo, params.number);
      return `✅ Pull Request #${params.number} merged successfully!`;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return `❌ Failed to merge PR: ${msg}`;
    }
  }

  private async handleListRepos(userId: string): Promise<string> {
    try {
      const repos = await this.githubService!.getUserRepos(10);

      if (repos.length === 0) {
        return '📦 You don\'t have any repositories yet.';
      }

      let response = '📦 Your Repositories\n\n';

      for (const repo of repos) {
        response += `🔹 ${repo.name}\n`;
        if (repo.description) {
          response += `   ${repo.description}\n`;
        }
        response += `   ⭐ ${repo.stars} | 🍴 ${repo.forks}\n`;
        response += `   🔗 ${repo.url}\n\n`;
      }

      return response.trim();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return `❌ Failed to list repos: ${msg}`;
    }
  }

  private async handleViewCommits(
    userId: string,
    params: Record<string, any>
  ): Promise<string> {
    if (!params.repo) {
      return '📝 Which repository?';
    }

    const [owner, repo] = params.repo.split('/');

    try {
      const commits = await this.githubService!.getCommits(owner, repo, 'main', 5);

      let response = `📜 Recent Commits\n\n`;

      for (const commit of commits) {
        response += `🔸 ${commit.sha.substring(0, 7)} - ${commit.message.split('\n')[0]}\n`;
        response += `👤 ${commit.author} | ${commit.date.toLocaleDateString()}\n\n`;
      }

      return response.trim();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return `❌ Failed to get commits: ${msg}`;
    }
  }

  private async handleCheckWorkflows(
    userId: string,
    params: Record<string, any>
  ): Promise<string> {
    if (!params.repo) {
      return '📝 Which repository?';
    }

    const [owner, repo] = params.repo.split('/');

    try {
      const runs = await this.githubService!.getWorkflowRuns(owner, repo, 5);

      if (runs.length === 0) {
        return `✅ No workflow runs found in ${params.repo}`;
      }

      let response = `🔄 Recent Workflow Runs\n\n`;

      for (const run of runs) {
        const statusEmoji = run.conclusion === 'success' ? '✅' :
                          run.conclusion === 'failure' ? '❌' : '⏳';

        response += `${statusEmoji} ${run.name}\n`;
        response += `🌿 ${run.branch}\n`;
        response += `Status: ${run.status} | Result: ${run.conclusion || 'Running'}\n`;
        response += `🔗 ${run.url}\n\n`;
      }

      return response.trim();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      return `❌ Failed to check workflows: ${msg}`;
    }
  }

  /**
   * Extract issue title and body from natural language
   */
  private extractIssueDetails(message: string): { title: string; body: string } {
    const titleMatch = message.match(/"([^"]+)"/);
    const title = titleMatch ? titleMatch[1] : message.substring(0, 50);
    const body = message;

    return { title, body };
  }

  /**
   * Get user's GitHub token from environment
   */
  private async getUserGitHubToken(userId: string): Promise<string | null> {
    // HACKATHON NOTE: In production, store encrypted tokens per user in database
    return process.env.GITHUB_PERSONAL_TOKEN || null;
  }

  /**
   * Get help message
   */
  private getHelpMessage(language: string): string {
    return `🤖 GitHub Commands:\n\n` +
      `📋 Issues:\n` +
      `• "Create issue in repo-name"\n` +
      `• "List issues in repo-name"\n` +
      `• "Close issue #123"\n\n` +
      `🔀 Pull Requests:\n` +
      `• "Create PR from feature to main"\n` +
      `• "List PRs in repo-name"\n` +
      `• "Merge PR #45"\n\n` +
      `📦 Repos:\n` +
      `• "List my repos"\n` +
      `• "Show commits in repo-name"\n\n` +
      `🔄 CI/CD:\n` +
      `• "Check workflows in repo-name"`;
  }
}
