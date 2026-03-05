/**
 * @file mcp-tools/github/pullrequests.tool.ts — GitHub Pull Requests MCP Tool
 */

import { z } from 'zod';
import { ToolRegistry } from '../registry.js';
import { GitHubService } from '../../services/github.service.js';

const createPRSchema = z.object({
  token: z.string(),
  owner: z.string(),
  repo: z.string(),
  title: z.string(),
  head: z.string().describe('Source branch'),
  base: z.string().describe('Target branch'),
  body: z.string().optional(),
});

ToolRegistry.register(
  {
    name: 'github_create_pr',
    description: 'Create a pull request in a GitHub repository',
    input_schema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'GitHub personal access token' },
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        title: { type: 'string', description: 'PR title' },
        head: { type: 'string', description: 'Source branch' },
        base: { type: 'string', description: 'Target branch' },
        body: { type: 'string', description: 'PR description' },
      },
      required: ['token', 'owner', 'repo', 'title', 'head', 'base'],
    },
  },
  async (args) => {
    const parsed = createPRSchema.parse(args);
    const service = new GitHubService({ token: parsed.token });
    return await service.createPullRequest(parsed.owner, parsed.repo, parsed.title, parsed.head, parsed.base, parsed.body);
  },
  createPRSchema
);

const listPRsSchema = z.object({
  token: z.string(),
  owner: z.string(),
  repo: z.string(),
  state: z.enum(['open', 'closed', 'all']).optional().default('open'),
  limit: z.number().optional().default(10),
});

ToolRegistry.register(
  {
    name: 'github_list_prs',
    description: 'List pull requests in a GitHub repository',
    input_schema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'GitHub personal access token' },
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        state: { type: 'string', description: 'Filter: open, closed, all', enum: ['open', 'closed', 'all'] },
        limit: { type: 'string', description: 'Max results' },
      },
      required: ['token', 'owner', 'repo'],
    },
  },
  async (args) => {
    const parsed = listPRsSchema.parse(args);
    const service = new GitHubService({ token: parsed.token });
    return await service.listPullRequests(parsed.owner, parsed.repo, parsed.state, parsed.limit);
  },
  listPRsSchema
);

const mergePRSchema = z.object({
  token: z.string(),
  owner: z.string(),
  repo: z.string(),
  pull_number: z.number(),
  merge_method: z.enum(['merge', 'squash', 'rebase']).optional().default('merge'),
});

ToolRegistry.register(
  {
    name: 'github_merge_pr',
    description: 'Merge a pull request',
    input_schema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'GitHub personal access token' },
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        pull_number: { type: 'string', description: 'PR number to merge' },
        merge_method: { type: 'string', description: 'Merge method', enum: ['merge', 'squash', 'rebase'] },
      },
      required: ['token', 'owner', 'repo', 'pull_number'],
    },
  },
  async (args) => {
    const parsed = mergePRSchema.parse(args);
    const service = new GitHubService({ token: parsed.token });
    await service.mergePullRequest(parsed.owner, parsed.repo, parsed.pull_number, parsed.merge_method);
    return { success: true, message: `PR #${parsed.pull_number} merged` };
  },
  mergePRSchema
);
