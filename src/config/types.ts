export enum AwsAccount {
  Development = "111111111111",
}

type Env = {
  account: AwsAccount;
  region: string;
};

export type Config = {
  env: Env;
};

export type PipelineConfig = {
  env: Env;
  codestarConnectionArn: string;
  branch: string;
  githubRepository: string;
  pipelineName: string;
};
