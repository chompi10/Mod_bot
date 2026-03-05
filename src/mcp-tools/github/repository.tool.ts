/**
 * @file mcp-tools/github/repository.tool.ts — GitHub Repository MCP Tool
 */

import { z } from 'zod';
import { ToolRegistry } from '../registry.js';
import { GitHubService } from '../../services/github.service.js';

const listReposSchema = z.object({
  token: z.string(),
  limit: z.number().optional().default(10),
});

ToolRegistry.register(
  {
    name: 'github_list_repos',
    description: 'List the authenticated user\'s GitHub repositories',
    input_schema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'GitHub personal access token' },
        limit: { type: 'string', description: 'Max repos to return' },
      },
      required: ['token'],
    },
  },
  async (args) => {
    const parsed = listReposSchema.parse(args);
    const service = new GitHubService({ token: parsed.token });
    return await service.getUserRepos(parsed.limit);
  },
  listReposSchema
);

const getCommitsSchema = z.object({
  token: z.string(),
  owner: z.string(),
  repo: z.string(),
  branch: z.string().optional().default('main'),
  limit: z.number().optional().default(10),
});

ToolRegistry.register(
  {
    name: 'github_get_commits',
    description: 'Get recent commits for a GitHub repository',
    input_schema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'GitHub personal access token' },
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        branch: { type: 'string', description: 'Branch name (default: main)' },
        limit: { type: 'string', description: 'Max commits to return' },
      },
      required: ['token', 'owner', 'repo'],
    },
  },
  async (args) => {
    const parsed = getCommitsSchema.parse(args);
    const service = new GitHubService({ token: parsed.token });
    return await service.getCommits(parsed.owner, parsed.repo, parsed.branch, parsed.limit);
  },
  getCommitsSchema
);
