import type { Config } from "./types";
import { AwsAccount, RetentionDays } from "./types";

export const devConfig: Config = {
  env: {
    account: AwsAccount.Development,
    region: "us-west-1",
  },
  environmentName: "dev",
  vpcCidr: "10.1.0.0/16",
  domain: "dev.example.com",
  valkey: {
    engineVersion: "9.0",
    nodeType: "cache.t4g.micro",
    numReplicas: 0,
  },
  livekit: {
    subdomain: "livekit",
    cpu: 1024,
    memory: 2048,
    desiredCount: 1,
    image: "livekit/livekit-server:v1.12",
    listenerRulePriority: 10,
    logRetentionDays: RetentionDays.ONE_MONTH,
  },
};
