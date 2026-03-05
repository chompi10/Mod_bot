/**
 * @file mcp-tools/github/issues.tool.ts — GitHub Issues MCP Tool
 *
 * Registers issue-related tools with the MCP ToolRegistry so
 * the LLM can create / list / close issues via function calling.
 */

import { z } from 'zod';
import { ToolRegistry } from '../registry.js';
import { GitHubService } from '../../services/github.service.js';

const createIssueSchema = z.object({
  token: z.string().describe('GitHub personal access token'),
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  title: z.string().describe('Issue title'),
  body: z.string().optional().describe('Issue body/description'),
  labels: z.array(z.string()).optional().describe('Labels to apply'),
});

ToolRegistry.register(
  {
    name: 'github_create_issue',
    description: 'Create a new issue in a GitHub repository',
    input_schema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'GitHub personal access token' },
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        title: { type: 'string', description: 'Issue title' },
        body: { type: 'string', description: 'Issue body/description' },
        labels: { type: 'string', description: 'Comma-separated labels' },
      },
      required: ['token', 'owner', 'repo', 'title'],
    },
  },
  async (args) => {
    const parsed = createIssueSchema.parse(args);
    const service = new GitHubService({ token: parsed.token });
    return await service.createIssue(parsed.owner, parsed.repo, parsed.title, parsed.body, parsed.labels);
  },
  createIssueSchema
);

const listIssuesSchema = z.object({
  token: z.string().describe('GitHub personal access token'),
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  state: z.enum(['open', 'closed', 'all']).optional().default('open'),
  limit: z.number().optional().default(10),
});

ToolRegistry.register(
  {
    name: 'github_list_issues',
    description: 'List issues in a GitHub repository',
    input_schema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'GitHub personal access token' },
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        state: { type: 'string', description: 'Filter by state: open, closed, all', enum: ['open', 'closed', 'all'] },
        limit: { type: 'string', description: 'Max results to return' },
      },
      required: ['token', 'owner', 'repo'],
    },
  },
  async (args) => {
    const parsed = listIssuesSchema.parse(args);
    const service = new GitHubService({ token: parsed.token });
    return await service.listIssues(parsed.owner, parsed.repo, parsed.state, parsed.limit);
  },
  listIssuesSchema
);

const closeIssueSchema = z.object({
  token: z.string().describe('GitHub personal access token'),
  owner: z.string().describe('Repository owner'),
  repo: z.string().describe('Repository name'),
  issue_number: z.number().describe('Issue number to close'),
});

ToolRegistry.register(
  {
    name: 'github_close_issue',
    description: 'Close an issue in a GitHub repository',
    input_schema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'GitHub personal access token' },
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        issue_number: { type: 'string', description: 'Issue number to close' },
      },
      required: ['token', 'owner', 'repo', 'issue_number'],
    },
  },
  async (args) => {
    const parsed = closeIssueSchema.parse(args);
    const service = new GitHubService({ token: parsed.token });
    await service.closeIssue(parsed.owner, parsed.repo, parsed.issue_number);
    return { success: true, message: `Issue #${parsed.issue_number} closed` };
  },
  closeIssueSchema
);
