import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import { SubnetType, Port, type IVpc } from "aws-cdk-lib/aws-ec2";
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
import {
  ApplicationTargetGroup,
  ApplicationProtocol,
  Protocol as ElbProtocol,
  TargetType,
  ApplicationListenerRule,
  ListenerCondition,
  ListenerAction,
  type ApplicationListener,
  type IApplicationLoadBalancer,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { ARecord, RecordTarget, type IHostedZone } from "aws-cdk-lib/aws-route53";
import { LoadBalancerTarget } from "aws-cdk-lib/aws-route53-targets";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";

import type { Config } from "../config";
import type { Valkey } from "./valkey";

interface LivekitServerProps {
  config: Config;
  vpc: IVpc;
  cluster: ICluster;
  albHttpsListener: ApplicationListener;
  hostedZone: IHostedZone;
  alb: IApplicationLoadBalancer;
  valkey: Valkey;
}

export class LivekitServer extends Construct {
  readonly secret: Secret;
  readonly taskDefinition: FargateTaskDefinition;
  readonly service: FargateService;

  constructor(scope: Construct, id: string, props: LivekitServerProps) {
    super(scope, id);

    const { config, vpc, cluster, albHttpsListener, hostedZone, alb, valkey } = props;

    this.secret = this.createSecret(config);
    this.taskDefinition = this.createTaskDefinition(config, valkey);
    this.service = this.createService(config, cluster);
    valkey.connections.allowDefaultPortFrom(this.service, "LiveKit to ValKey");
    this.createAlbTarget(config, vpc, albHttpsListener);
    this.createDnsRecord(config, hostedZone, alb);
  }

  private createSecret(config: Config): Secret {
    const apiKey = `artemis-${config.environmentName}-livekit`;
    return new Secret(this, "LivekitServerSecret", {
      secretName: `${config.environmentName}/artemis/livekit`,
      description: "LiveKit API key and secret",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ api_key: apiKey }),
        generateStringKey: "api_secret",
        excludePunctuation: true,
        passwordLength: 64,
      },
    });
  }

  private createTaskDefinition(config: Config, valkey: Valkey): FargateTaskDefinition {
    const { livekit } = config;

    const valkeyAddress = valkey.replicationGroup.attrPrimaryEndPointAddress;
    const valkeyPort = valkey.replicationGroup.attrPrimaryEndPointPort;

    const livekitConfig = `\
port: 7880
rtc:
  port_range_start: 50000
  port_range_end: 60000
  tcp_port: 7881
  use_external_ip: true
redis:
  address: ${valkeyAddress}:${valkeyPort}
  use_tls: true`;

    const taskDef = new FargateTaskDefinition(this, "LivekitServerTaskDefinition", {
      family: "artemis-livekit-server",
      cpu: livekit.cpu,
      memoryLimitMiB: livekit.memory,
      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.ARM64,
        operatingSystemFamily: OperatingSystemFamily.LINUX,
      },
    });

    this.secret.grantRead(taskDef.taskRole);
    valkey.authSecret.grantRead(taskDef.taskRole);

    taskDef.addContainer("LivekitServer", {
      containerName: "livekit-server",
      image: ContainerImage.fromRegistry(livekit.image),
      stopTimeout: Duration.seconds(120),
      entryPoint: ["/bin/sh", "-c"],
      command: ['/livekit-server --keys "$LIVEKIT_API_KEY: $LIVEKIT_API_SECRET" --redis-password "$VALKEY_AUTH_TOKEN"'],
      environment: {
        LIVEKIT_CONFIG: livekitConfig,
      },
      secrets: {
        LIVEKIT_API_KEY: EcsSecret.fromSecretsManager(this.secret, "api_key"),
        LIVEKIT_API_SECRET: EcsSecret.fromSecretsManager(this.secret, "api_secret"),
        VALKEY_AUTH_TOKEN: EcsSecret.fromSecretsManager(valkey.authSecret),
      },
      healthCheck: {
        command: ["CMD-SHELL", "wget --spider -q http://localhost:7880/ || exit 1"],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60),
      },
      logging: LogDrivers.awsLogs({
        streamPrefix: "livekit-server",
        logRetention: livekit.logRetentionDays,
      }),
      portMappings: [
        { containerPort: 7880, protocol: EcsProtocol.TCP },
        { containerPort: 7881, protocol: EcsProtocol.TCP },
        { containerPort: 0, containerPortRange: "50000-60000", protocol: EcsProtocol.UDP },
      ],
    });

    return taskDef;
  }

  private createService(config: Config, cluster: ICluster): FargateService {
    const service = new FargateService(this, "LivekitServerService", {
      serviceName: "artemis-livekit-server",
      cluster,
      taskDefinition: this.taskDefinition,
      desiredCount: config.livekit.desiredCount,
      assignPublicIp: true,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      healthCheckGracePeriod: Duration.seconds(120),
      circuitBreaker: { rollback: true },
    });

    // WebRTC signaling (7881 TCP) and media (50000-60000 UDP) go directly
    // to task public IPs — not through any load balancer.
    service.connections.allowFromAnyIpv4(Port.tcp(7881), "WebRTC TCP signaling");
    service.connections.allowFromAnyIpv4(Port.udpRange(50000, 60000), "WebRTC UDP media");

    return service;
  }

  private createAlbTarget(config: Config, vpc: IVpc, albHttpsListener: ApplicationListener): void {
    const { livekit, domain } = config;

    const targetGroup = new ApplicationTargetGroup(this, "LivekitServerTargetGroup", {
      vpc,
      port: 7880,
      protocol: ApplicationProtocol.HTTP,
      targetType: TargetType.IP,
      healthCheck: {
        path: "/",
        port: "7880",
        protocol: ElbProtocol.HTTP,
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
        interval: Duration.seconds(15),
        timeout: Duration.seconds(5),
      },
    });

    this.service.attachToApplicationTargetGroup(targetGroup);

    new ApplicationListenerRule(this, "LivekitServerListenerRule", {
      listener: albHttpsListener,
      priority: livekit.listenerRulePriority,
      conditions: [ListenerCondition.hostHeaders([`${livekit.subdomain}.${domain}`])],
      action: ListenerAction.forward([targetGroup]),
    });
  }

  private createDnsRecord(config: Config, hostedZone: IHostedZone, alb: IApplicationLoadBalancer): void {
    const { livekit, domain } = config;

    new ARecord(this, "LivekitServerDnsRecord", {
      zone: hostedZone,
      recordName: `${livekit.subdomain}.${domain}`,
      target: RecordTarget.fromAlias(new LoadBalancerTarget(alb)),
    });
  }
}
