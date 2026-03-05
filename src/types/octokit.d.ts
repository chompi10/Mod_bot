declare module '@octokit/rest' {
  export class Octokit {
    constructor(options?: { auth?: string; [key: string]: any });

    issues: {
      create(params: any): Promise<{ data: any }>;
      listForRepo(params: any): Promise<{ data: any[] }>;
      update(params: any): Promise<{ data: any }>;
    };

    pulls: {
      create(params: any): Promise<{ data: any }>;
      list(params: any): Promise<{ data: any[] }>;
      merge(params: any): Promise<{ data: any }>;
    };

    repos: {
      listForAuthenticatedUser(params?: any): Promise<{ data: any[] }>;
      listCommits(params: any): Promise<{ data: any[] }>;
    };

    actions: {
      listWorkflowRunsForRepo(params: any): Promise<{ data: { workflow_runs: any[] } }>;
    };
  }
}

declare module '@octokit/webhooks' {
  export class Webhooks {
    constructor(options?: any);
    on(event: string, handler: (context: any) => void): void;
    verifyAndReceive(options: any): Promise<void>;
  }
}
