export enum AwsAccount {
  Development = "438641188435",
}

type Env = {
  account: AwsAccount;
  region: string;
};

export type Config = {
  env: Env;
  vpcCidr: string;
  domain: string;
};

export type PipelineConfig = {
  env: Env;
  codestarConnectionArn: string;
  branch: string;
  githubRepository: string;
  pipelineName: string;
};
