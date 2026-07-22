import type { Config } from "./types";
import { AwsAccount, RetentionDays } from "./types";

export const devConfig: Config = {
  env: {
    account: AwsAccount.Development,
    region: "us-west-1",
  },
  environmentName: "dev",
  vpcCidr: "10.1.0.0/16",
  domain: "dev.getartemishealth.com",
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
    logRetentionDays: RetentionDays.SIX_MONTHS,
  },
  livekitAgents: {
    cpu: 1024,
    memory: 2048,
    desiredCount: 1,
    imageTag: "latest",
    logRetentionDays: RetentionDays.SIX_MONTHS,
    bedrockRegion: "us-east-1",
    bedrockModelIds: ["amazon.nova-2-sonic-v1:0"],
    agentName: "artemis-agent",
  },
  livekitSip: {
    subdomain: "sip",
    cpu: 1024,
    memory: 2048,
    desiredCount: 1,
    image: "livekit/sip:latest",
    logRetentionDays: RetentionDays.SIX_MONTHS,
    twilio: {
      signalingCidrs: [
        "54.172.60.0/30", // North Virginia
        "54.244.51.0/30", // Oregon
        "54.171.127.192/30", // Ireland
        "35.156.191.128/30", // Frankfurt
        "54.65.63.192/30", // Tokyo
        "54.169.127.128/30", // Singapore
        "54.252.254.64/30", // Sydney
        "177.71.206.192/30", // São Paulo
      ],
      mediaCidrs: [
        "168.86.128.0/18", // Twilio global media/SRTP
      ],
    },
  },
};
