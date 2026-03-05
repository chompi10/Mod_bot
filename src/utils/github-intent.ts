export enum GitHubIntent {
  CREATE_ISSUE = 'create_issue',
  LIST_ISSUES = 'list_issues',
  CLOSE_ISSUE = 'close_issue',
  CREATE_PR = 'create_pr',
  LIST_PRS = 'list_prs',
  MERGE_PR = 'merge_pr',
  LIST_REPOS = 'list_repos',
  VIEW_COMMITS = 'view_commits',
  CHECK_WORKFLOWS = 'check_workflows',
  SEARCH_CODE = 'search_code',
  UNKNOWN = 'unknown',
}

export interface GitHubIntentResult {
  intent: string;
  confidence: number;
  params: Record<string, any>;
}

/**
 * Detect if message is GitHub-related and extract intent
 */
export function detectGitHubIntent(message: string): GitHubIntentResult | null {
  const lower = message.toLowerCase();

  // Quick keyword check
  const githubKeywords = [
    'github', 'repo', 'repository', 'issue', 'pr', 'pull request',
    'commit', 'branch', 'merge', 'workflow', 'ci', 'cd', 'build',
    'fork', 'clone', 'push', 'pull'
  ];

  const repoPattern = /[a-zA-Z0-9-_]+\/[a-zA-Z0-9-_]+/;
  if(repoPattern.test(message)){
    return{
      confidence:0.95,
      intent:'github_repo_mentioned',
      params: extractParams(message),
    };
  }
  const hasGitHubKeyword = githubKeywords.some(kw => lower.includes(kw));
  if (hasGitHubKeyword) {
    return {
      confidence: 0.85,
      intent: 'github_general',
      params: extractParams(message),
    };
  }

  return null;
}
  // Intent patterns
  const patterns: Array<{
    intent: GitHubIntent;
    regex: RegExp;
    confidence: number;
  }> = [
    {
      intent: GitHubIntent.CREATE_ISSUE,
      regex: /create|new|open|add.*issue/i,
      confidence: 0.9,
    },
    {
      intent: GitHubIntent.LIST_ISSUES,
      regex: /list|show|view|get.*issue/i,
      confidence: 0.85,
    },
    {
      intent: GitHubIntent.CLOSE_ISSUE,
      regex: /close|resolve.*issue/i,
      confidence: 0.9,
    },
    {
      intent: GitHubIntent.CREATE_PR,
      regex: /create|new|open.*pr|pull request/i,
      confidence: 0.9,
    },
    {
      intent: GitHubIntent.LIST_PRS,
      regex: /list|show|view.*pr|pull request/i,
      confidence: 0.85,
    },
    {
      intent: GitHubIntent.MERGE_PR,
      regex: /merge.*pr|pull request/i,
      confidence: 0.95,
    },
    {
      intent: GitHubIntent.LIST_REPOS,
      regex: /list|show|my.*repo/i,
      confidence: 0.85,
    },
    {
      intent: GitHubIntent.VIEW_COMMITS,
      regex: /commit|history|log/i,
      confidence: 0.8,
    },
    {
      intent: GitHubIntent.CHECK_WORKFLOWS,
      regex: /workflow|pipeline|ci|cd|build/i,
      confidence: 0.8,
    },
  ];

  for (const pattern of patterns) {
    if (pattern.regex.test(message)) {
      return {
        intent: pattern.intent,
        confidence: pattern.confidence,
        params: extractParams(message, pattern.intent),
      };
    }
  }

  return {
    intent: GitHubIntent.UNKNOWN,
    confidence: 0.5,
    params: {},
  };
}
/**
 * Extract parameters from message based on intent
 */
function extractParams(message: string): Record<string, any> {
  const params: Record<string, any> = {};

  // Extract repo name (owner/repo or just repo)
  const repoMatch = message.match(/([a-zA-Z0-9-_]+\/[a-zA-Z0-9-_]+)/);
  if (repoMatch) {
    params.repo = repoMatch[1];
  }

  // Extract issue/PR number
  const numberMatch = message.match(/#?(\d+)/);
  if (numberMatch) {
    params.number = parseInt(numberMatch[1]);
  }

  // Extract branch names
  const branchMatch = message.match(/(?:from|merge)\s+([a-zA-Z0-9-_/]+)(?:\s+to|\s+into)\s+([a-zA-Z0-9-_/]+)/i);
  if (branchMatch) {
    params.head = branchMatch[1];
    params.base = branchMatch[2];
  }

  return params;
}

/**
 * Check if user has GitHub access configured
 */
export function hasGitHubAccess(userId: string): boolean {
  // TODO: Check memory/GITHUB_INTEGRATION.md for user's token
  return false; // Placeholder
}

