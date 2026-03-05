/**
 * @file mcp-tools/github/workflows.tool.ts — GitHub Workflows MCP Tool
 */

import { z } from 'zod';
import { ToolRegistry } from '../registry.js';
import { GitHubService } from '../../services/github.service.js';

const getWorkflowRunsSchema = z.object({
  token: z.string(),
  owner: z.string(),
  repo: z.string(),
  limit: z.number().optional().default(5),
});

ToolRegistry.register(
  {
    name: 'github_get_workflow_runs',
    description: 'Get recent CI/CD workflow runs for a GitHub repository',
    input_schema: {
      type: 'object',
      properties: {
        token: { type: 'string', description: 'GitHub personal access token' },
        owner: { type: 'string', description: 'Repository owner' },
        repo: { type: 'string', description: 'Repository name' },
        limit: { type: 'string', description: 'Max workflow runs to return' },
      },
      required: ['token', 'owner', 'repo'],
    },
  },
  async (args) => {
    const parsed = getWorkflowRunsSchema.parse(args);
    const service = new GitHubService({ token: parsed.token });
    return await service.getWorkflowRuns(parsed.owner, parsed.repo, parsed.limit);
  },
  getWorkflowRunsSchema
);
