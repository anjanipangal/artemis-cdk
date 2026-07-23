import { RetentionDays } from "aws-cdk-lib/aws-logs";

export { RetentionDays };

export enum AwsAccount {
  Development = "438641188435",
}

type Env = {
  account: AwsAccount;
  region: string;
};

export type ValKeyConfig = {
  engineVersion: string;
  nodeType: string;
  numReplicas: number;
};

export type LivekitConfig = {
  subdomain: string;
  cpu: number;
  memory: number;
  desiredCount: number;
  image: string;
  listenerRulePriority: number;
  logRetentionDays: RetentionDays;
};

export type TwilioConfig = {
  // Reference: https://www.twilio.com/docs/sip-trunking#ip-addresses
  signalingCidrs: string[];
  mediaCidrs: string[];
};

export type LivekitSipConfig = {
  subdomain: string;
  cpu: number;
  memory: number;
  desiredCount: number;
  image: string;
  logRetentionDays: RetentionDays;
  twilio: TwilioConfig;
};

export type LivekitAgentsConfig = {
  cpu: number;
  memory: number;
  desiredCount: number;
  imageTag: string;
  logRetentionDays: RetentionDays;
  bedrockRegion: string;
  bedrockModelIds: string[];
  agentName: string;
};

export type OutboundTrunkConfig = {
  name: string;
  address: string;
  outboundCallerIds: string[];
  configVersion: number; // Bump to force re-creation of the outbound trunk (When Secret value changes)
};

export type SipConfigConfig = {
  outboundTrunks: OutboundTrunkConfig[];
  logRetentionDays: RetentionDays;
};

export type Config = {
  env: Env;
  environmentName: string;
  vpcCidr: string;
  domain: string;
  valkey: ValKeyConfig;
  livekit: LivekitConfig;
  livekitSip: LivekitSipConfig;
  livekitAgents: LivekitAgentsConfig;
  sipConfig?: SipConfigConfig;
};

export type PipelineConfig = {
  env: Env;
  codestarConnectionArn: string;
  branch: string;
  githubRepository: string;
  pipelineName: string;
};
