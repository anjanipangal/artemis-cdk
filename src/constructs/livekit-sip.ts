import { Construct } from "constructs";
import { Duration } from "aws-cdk-lib";
import { SubnetType, Port, Peer, type IVpc } from "aws-cdk-lib/aws-ec2";
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
  NetworkTargetGroup,
  NetworkListenerAction,
  Protocol as ElbProtocol,
  TargetType,
  type NetworkLoadBalancer,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { ARecord, RecordTarget, type IHostedZone } from "aws-cdk-lib/aws-route53";
import { LoadBalancerTarget } from "aws-cdk-lib/aws-route53-targets";

import type { Config } from "../config";
import type { LivekitServer } from "./livekit-server";
import type { Valkey } from "./valkey";

interface LivekitSipProps {
  config: Config;
  vpc: IVpc;
  cluster: ICluster;
  nlb: NetworkLoadBalancer;
  hostedZone: IHostedZone;
  valkey: Valkey;
  livekitServer: LivekitServer;
}

export class LivekitSip extends Construct {
  readonly taskDefinition: FargateTaskDefinition;
  readonly service: FargateService;

  constructor(scope: Construct, id: string, props: LivekitSipProps) {
    super(scope, id);

    const { config, vpc, cluster, nlb, hostedZone, valkey, livekitServer } = props;

    this.taskDefinition = this.createTaskDefinition(config, valkey, livekitServer);
    this.service = this.createService(config, cluster);
    valkey.connections.allowDefaultPortFrom(this.service, "LiveKit SIP to ValKey");
    this.createNlbTargets(vpc, nlb);
    this.createDnsRecord(config, hostedZone, nlb);
  }

  private createTaskDefinition(config: Config, valkey: Valkey, livekitServer: LivekitServer): FargateTaskDefinition {
    const { livekitSip, livekit, domain } = config;

    const valkeyAddress = valkey.replicationGroup.attrPrimaryEndPointAddress;
    const valkeyPort = valkey.replicationGroup.attrPrimaryEndPointPort;

    const sipConfigBody = `\
sip_port: 5060
tls_port: 5061
rtp_port: 10000-60000
use_external_ip: true
health_port: 8080
ws_url: wss://${livekit.subdomain}.${domain}
redis:
  address: ${valkeyAddress}:${valkeyPort}
  use_tls: true`;

    const taskDef = new FargateTaskDefinition(this, "LivekitSipTaskDefinition", {
      family: "artemis-livekit-sip",
      cpu: livekitSip.cpu,
      memoryLimitMiB: livekitSip.memory,
      runtimePlatform: {
        cpuArchitecture: CpuArchitecture.ARM64,
        operatingSystemFamily: OperatingSystemFamily.LINUX,
      },
    });

    livekitServer.secret.grantRead(taskDef.taskRole);
    valkey.authSecret.grantRead(taskDef.taskRole);

    taskDef.addContainer("LivekitSip", {
      containerName: "livekit-sip",
      image: ContainerImage.fromRegistry(livekitSip.image),
      stopTimeout: Duration.seconds(120),
      entryPoint: ["/bin/sh", "-c"],
      command: ['livekit-sip --config-body "$SIP_CONFIG_BODY$(printf \'\\n  password: %s\' "$VALKEY_AUTH_TOKEN")"'],
      environment: {
        SIP_CONFIG_BODY: sipConfigBody,
      },
      secrets: {
        LIVEKIT_API_KEY: EcsSecret.fromSecretsManager(livekitServer.secret, "api_key"),
        LIVEKIT_API_SECRET: EcsSecret.fromSecretsManager(livekitServer.secret, "api_secret"),
        VALKEY_AUTH_TOKEN: EcsSecret.fromSecretsManager(valkey.authSecret),
      },
      healthCheck: {
        command: ["CMD-SHELL", "bash -c 'echo > /dev/tcp/localhost/8080' || exit 1"],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60),
      },
      logging: LogDrivers.awsLogs({
        streamPrefix: "livekit-sip",
        logRetention: livekitSip.logRetentionDays,
      }),
      portMappings: [
        { containerPort: 5060, protocol: EcsProtocol.TCP },
        { containerPort: 5061, protocol: EcsProtocol.TCP },
        { containerPort: 0, containerPortRange: "10000-60000", protocol: EcsProtocol.UDP },
        { containerPort: 8080, protocol: EcsProtocol.TCP },
      ],
    });

    return taskDef;
  }

  private createService(config: Config, cluster: ICluster): FargateService {
    const service = new FargateService(this, "LivekitSipService", {
      serviceName: "artemis-livekit-sip",
      cluster,
      taskDefinition: this.taskDefinition,
      desiredCount: config.livekitSip.desiredCount,
      assignPublicIp: true,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      healthCheckGracePeriod: Duration.seconds(60),
      circuitBreaker: { rollback: true },
    });

    const { twilio } = config.livekitSip;

    for (const cidr of twilio.signalingCidrs) {
      service.connections.allowFrom(Peer.ipv4(cidr), Port.tcp(5060), `SIP TCP from ${cidr}`);
      service.connections.allowFrom(Peer.ipv4(cidr), Port.udp(5060), `SIP UDP from ${cidr}`);
      service.connections.allowFrom(Peer.ipv4(cidr), Port.tcp(5061), `SIP TLS from ${cidr}`);
    }

    for (const cidr of twilio.mediaCidrs) {
      service.connections.allowFrom(Peer.ipv4(cidr), Port.udpRange(10000, 60000), `RTP UDP from ${cidr}`);
    }

    return service;
  }

  private createNlbTargets(vpc: IVpc, nlb: NetworkLoadBalancer): void {
    const healthCheck = {
      protocol: ElbProtocol.TCP,
      port: "8080",
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 3,
      interval: Duration.seconds(30),
    };

    // TCP_UDP 5060 - plain SIP
    const tg5060 = new NetworkTargetGroup(this, "LivekitSipTg5060", {
      vpc,
      port: 5060,
      protocol: ElbProtocol.TCP_UDP,
      targetType: TargetType.IP,
      healthCheck,
    });
    tg5060.addTarget(
      this.service.loadBalancerTarget({
        containerName: "livekit-sip",
        containerPort: 5060,
        protocol: EcsProtocol.TCP,
      }),
    );
    nlb.addListener("LivekitSipTcpUdpListener", {
      port: 5060,
      protocol: ElbProtocol.TCP_UDP,
      defaultAction: NetworkListenerAction.forward([tg5060]),
    });

    // TCP 5061 - SIP TLS passthrough (container handles TLS natively)
    const tg5061 = new NetworkTargetGroup(this, "LivekitSipTg5061", {
      vpc,
      port: 5061,
      protocol: ElbProtocol.TCP,
      targetType: TargetType.IP,
      healthCheck,
    });
    tg5061.addTarget(
      this.service.loadBalancerTarget({
        containerName: "livekit-sip",
        containerPort: 5061,
        protocol: EcsProtocol.TCP,
      }),
    );
    nlb.addListener("LivekitSipTlsListener", {
      port: 5061,
      protocol: ElbProtocol.TCP,
      defaultAction: NetworkListenerAction.forward([tg5061]),
    });
  }

  private createDnsRecord(config: Config, hostedZone: IHostedZone, nlb: NetworkLoadBalancer): void {
    const { livekitSip, domain } = config;

    new ARecord(this, "LivekitSipDnsRecord", {
      zone: hostedZone,
      recordName: `${livekitSip.subdomain}.${domain}`,
      target: RecordTarget.fromAlias(new LoadBalancerTarget(nlb)),
    });
  }
}
