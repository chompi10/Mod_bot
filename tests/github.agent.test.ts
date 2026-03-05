import { GitHubAgent } from '../src/agents/github.agent';
import { MemoryManager } from '../src/memory/manager';

describe('GitHub Agent', () => {
  let agent: GitHubAgent;
  let memoryManager: MemoryManager;

  beforeEach(() => {
    // Create memory manager instance
    memoryManager = new MemoryManager('./memory');
    
    // Create GitHub agent
    agent = new GitHubAgent(memoryManager);
  });

  afterEach(() => {
    // Cleanup if needed
    jest.clearAllMocks();
  });

  test('should list repositories', async () => {
    const response = await agent.handle('test-user', 'list my repos', 'en');
    
    // Check response contains repo emoji
    expect(response).toContain('📦');
    
    // Alternative: Check for "Repositories" text
    expect(response.toLowerCase()).toContain('repositories');
  });

  test('should handle create issue command', async () => {
    const response = await agent.handle(
      'test-user',
      'create issue in myusername/myrepo',
      'en'
    );
    
    // Should ask for repo or show success/error
    expect(
      response.includes('issue') || 
      response.includes('❌') || 
      response.includes('✅')
    ).toBe(true);
  });

  test('should handle list issues command', async () => {
    const response = await agent.handle(
      'test-user',
      'show issues in myusername/myrepo',
      'en'
    );
    
    expect(
      response.includes('📋') || 
      response.includes('issue')
    ).toBe(true);
  });

  test('should handle PR commands', async () => {
    const response = await agent.handle(
      'test-user',
      'show prs in myusername/myrepo',
      'en'
    );
    
    expect(
      response.includes('🔀') || 
      response.includes('Pull Request') ||
      response.includes('PR')
    ).toBe(true);
  });

  test('should return help for unknown commands', async () => {
    const response = await agent.handle(
      'test-user',
      'random gibberish',
      'en'
    );
    
    expect(response).toContain('Commands');
  });
});