import { Construct } from "constructs";
import { CustomResource, Duration, RemovalPolicy } from "aws-cdk-lib";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";
import { DockerImageCode, DockerImageFunction, Architecture } from "aws-cdk-lib/aws-lambda";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Provider } from "aws-cdk-lib/custom-resources";

import * as path from "node:path";

import type { Config } from "../config";
import type { LivekitServer } from "./livekit-server";

interface SipConfigProps {
  config: Config;
  livekitServer: LivekitServer;
}

export class SipConfig extends Construct {
  readonly twilioCredentialsSecret?: Secret;

  constructor(scope: Construct, id: string, props: SipConfigProps) {
    super(scope, id);

    const { config, livekitServer } = props;
    const sipConfig = config.sipConfig;

    if (!sipConfig || sipConfig.outboundTrunks.length === 0) {
      return;
    }

    const { environmentName, domain, livekit } = config;

    this.twilioCredentialsSecret = new Secret(this, "TwilioCredentials", {
      secretName: `${environmentName}/artemis/twilio`,
      description: "Twilio SIP trunk credentials (username and password)",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "REPLACE_ME" }),
        generateStringKey: "password",
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    const onEventFn = new DockerImageFunction(this, "SipConfigFunction", {
      functionName: `${environmentName}-sip-config`,
      description: "Manages LiveKit SIP outbound trunks via the LiveKit API.",
      code: DockerImageCode.fromImageAsset(path.join(__dirname, "sip-config-lambda"), {
        platform: Platform.LINUX_ARM64,
      }),
      architecture: Architecture.ARM_64,
      timeout: Duration.minutes(1),
      memorySize: 512,
      environment: {
        LIVEKIT_URL: `https://${livekit.subdomain}.${domain}`,
        LIVEKIT_SECRET_ARN: livekitServer.secret.secretArn,
      },
      logGroup: new LogGroup(this, "SipConfigFunctionLogs", {
        retention: sipConfig.logRetentionDays,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });

    livekitServer.secret.grantRead(onEventFn);
    this.twilioCredentialsSecret.grantRead(onEventFn);

    const provider = new Provider(this, "SipConfigProvider", {
      onEventHandler: onEventFn,
      logGroup: new LogGroup(this, "SipConfigProviderLogs", {
        retention: sipConfig.logRetentionDays,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });

    for (const [i, trunk] of sipConfig.outboundTrunks.entries()) {
      const customResource = new CustomResource(this, `SipOutboundTrunk${i}`, {
        serviceToken: provider.serviceToken,
        properties: {
          trunk_name: trunk.name,
          address: trunk.address,
          numbers: JSON.stringify(trunk.outboundCallerIds),
          twilio_credentials_secret_arn: this.twilioCredentialsSecret.secretArn,
          config_version: trunk.configVersion.toString(),
        },
      });

      customResource.node.addDependency(livekitServer.service);
    }
  }
}
