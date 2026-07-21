import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import { SubnetType, type IVpc } from "aws-cdk-lib/aws-ec2";
import type { Repository } from "aws-cdk-lib/aws-ecr";
import {
  CpuArchitecture,
  FargateTaskDefinition,
  FargateService,
  ContainerImage,
  Secret as EcsSecret,
  OperatingSystemFamily,
  Protocol as EcsProtocol,
  LogDrivers,
} from "aws-cdk-lib/aws-ecs";
import type { ICluster } from "aws-cdk-lib/aws-ecs";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";

import type { Config } from "../config";
import type { LivekitServer } from "./livekit-server";

interface LivekitAgentsProps {
  config: Config;
  vpc: IVpc;
  cluster: ICluster;
  repository: Repository;
  livekitServer: LivekitServer;
}

export class LivekitAgents extends Construct {
  readonly taskDefinition: FargateTaskDefinition;
  readonly service: FargateService;

  constructor(scope: Construct, id: string, props: LivekitAgentsProps) {
    super(scope, id);

    const { config, cluster, repository, livekitServer } = props;

    this.taskDefinition = this.createTaskDefinition(config, repository, livekitServer);
    this.service = this.createService(config, cluster);
  }

  private createTaskDefinition(
    config: Config,
    repository: Repository,
    livekitServer: LivekitServer,
  ): FargateTaskDefinition {
    const { livekitAgents, livekit, domain } = config;

    const taskDef = new FargateTaskDefinition(this, "LivekitAgentsTaskDefinition", {
      family: "artemis-livekit-agents",
      cpu: livekitAgents.cpu,
      memoryLimitMiB: livekitAgents.memory,
      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.ARM64,
        operatingSystemFamily: OperatingSystemFamily.LINUX,
      },
    });

    // Agent fetches LiveKit credentials at runtime via LIVEKIT_SECRET_NAME
    livekitServer.secret.grantRead(taskDef.taskRole);

    const bedrockModelArns = livekitAgents.bedrockModelIds.map(
      (modelId) => `arn:aws:bedrock:${livekitAgents.bedrockRegion}::foundation-model/${modelId}`,
    );
    taskDef.taskRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:InvokeModelWithBidirectionalStream",
        ],
        resources: bedrockModelArns,
      }),
    );

    taskDef.addContainer("LivekitAgents", {
      containerName: "livekit-agents",
      image: ContainerImage.fromEcrRepository(repository, livekitAgents.imageTag),
      stopTimeout: Duration.seconds(120),
      environment: {
        LIVEKIT_URL: `wss://${livekit.subdomain}.${domain}`,
        LIVEKIT_SECRET_NAME: livekitServer.secret.secretName,
        AWS_BEDROCK_REGION: livekitAgents.bedrockRegion,
        LIVEKIT_AGENT_NAME: livekitAgents.agentName,
      },
      secrets: {
        LIVEKIT_API_KEY: EcsSecret.fromSecretsManager(livekitServer.secret, "api_key"),
        LIVEKIT_API_SECRET: EcsSecret.fromSecretsManager(livekitServer.secret, "api_secret"),
      },
      portMappings: [{ containerPort: 8081, protocol: EcsProtocol.TCP }],
      healthCheck: {
        command: ["CMD-SHELL", "curl -f http://localhost:8081/ || exit 1"],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60),
      },
      logging: LogDrivers.awsLogs({
        streamPrefix: "livekit-agents",
        logRetention: livekitAgents.logRetentionDays,
      }),
    });

    return taskDef;
  }

  private createService(config: Config, cluster: ICluster): FargateService {
    return new FargateService(this, "LivekitAgentsService", {
      serviceName: "artemis-livekit-agents",
      cluster,
      taskDefinition: this.taskDefinition,
      desiredCount: config.livekitAgents.desiredCount,
      assignPublicIp: false,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      healthCheckGracePeriod: Duration.seconds(60),
      circuitBreaker: { rollback: true },
    });
  }
}
