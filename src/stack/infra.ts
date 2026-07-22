import type { Construct } from "constructs";
import type { StackProps } from "aws-cdk-lib";
import { Stack, Tags } from "aws-cdk-lib";
import { Certificate, CertificateValidation } from "aws-cdk-lib/aws-certificatemanager";
import { Vpc, SubnetType, IpAddresses } from "aws-cdk-lib/aws-ec2";
import { Cluster, ContainerInsights } from "aws-cdk-lib/aws-ecs";
import {
  ApplicationLoadBalancer,
  ApplicationListener,
  ApplicationProtocol,
  ListenerAction,
  NetworkLoadBalancer,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { HostedZone, type IHostedZone } from "aws-cdk-lib/aws-route53";

import type { Config } from "../config";
import { LivekitAgents } from "../constructs/livekit-agents";
import { LivekitServer } from "../constructs/livekit-server";
import { LivekitSip } from "../constructs/livekit-sip";
import { Valkey } from "../constructs/valkey";
import type { AssetsStack } from "./assets";

export class InfraStack extends Stack {
  readonly config: Config;
  readonly vpc: Vpc;
  readonly cluster: Cluster;
  readonly alb: ApplicationLoadBalancer;
  readonly nlb: NetworkLoadBalancer;
  readonly hostedZone: IHostedZone;
  readonly certificate: Certificate;
  readonly albHttpsListener: ApplicationListener;
  readonly valkey: Valkey;
  readonly livekitServer: LivekitServer;
  readonly livekitSip: LivekitSip;
  readonly livekitAgents: LivekitAgents;

  constructor(scope: Construct, id: string, config: Config, assetsStack: AssetsStack, props?: StackProps) {
    super(scope, id, { ...props, env: config.env });
    this.config = config;

    Tags.of(this).add("Project", "Artemis");
    Tags.of(this).add("GitRepository", "https://github.com/anjanipangal/artemis-cdk");

    this.vpc = this.createVpc(config);
    this.cluster = this.createCluster();
    this.alb = this.createAlb();
    this.nlb = this.createNlb();
    this.hostedZone = this.importHostedZone(config);
    this.certificate = this.createCertificate(config);
    this.albHttpsListener = this.createAlbHttpsListener();
    this.valkey = new Valkey(this, "Valkey", { config, vpc: this.vpc });
    this.livekitServer = new LivekitServer(this, "LivekitServer", {
      config,
      vpc: this.vpc,
      cluster: this.cluster,
      albHttpsListener: this.albHttpsListener,
      hostedZone: this.hostedZone,
      alb: this.alb,
      valkey: this.valkey,
    });
    this.livekitSip = new LivekitSip(this, "LivekitSip", {
      config,
      vpc: this.vpc,
      cluster: this.cluster,
      nlb: this.nlb,
      hostedZone: this.hostedZone,
      valkey: this.valkey,
      livekitServer: this.livekitServer,
    });
    this.livekitAgents = new LivekitAgents(this, "LivekitAgents", {
      config,
      vpc: this.vpc,
      cluster: this.cluster,
      repository: assetsStack.repository,
      livekitServer: this.livekitServer,
    });
  }

  private createAlbHttpsListener(): ApplicationListener {
    return this.alb.addListener("HttpsListener", {
      port: 443,
      protocol: ApplicationProtocol.HTTPS,
      certificates: [this.certificate],
      defaultAction: ListenerAction.fixedResponse(404, {
        contentType: "text/plain",
        messageBody: "Not Found",
      }),
    });
  }

  private createCertificate(config: Config): Certificate {
    return new Certificate(this, "Certificate", {
      domainName: `*.${config.domain}`,
      validation: CertificateValidation.fromDns(this.hostedZone),
    });
  }

  private importHostedZone(config: Config): IHostedZone {
    return HostedZone.fromLookup(this, "HostedZone", {
      domainName: config.domain,
    });
  }

  private createAlb(): ApplicationLoadBalancer {
    return new ApplicationLoadBalancer(this, "Alb", {
      vpc: this.vpc,
      loadBalancerName: `${this.config.environmentName}-public-alb-shared`,
      internetFacing: true,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
    });
  }

  private createNlb(): NetworkLoadBalancer {
    return new NetworkLoadBalancer(this, "Nlb", {
      vpc: this.vpc,
      loadBalancerName: `${this.config.environmentName}-public-nlb-shared`,
      internetFacing: true,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      crossZoneEnabled: false,
    });
  }

  private createCluster(): Cluster {
    return new Cluster(this, "Cluster", {
      vpc: this.vpc,
      clusterName: `${this.config.environmentName}-cluster`,
      containerInsightsV2: ContainerInsights.DISABLED,
    });
  }

  private createVpc(config: Config): Vpc {
    return new Vpc(this, "Vpc", {
      ipAddresses: IpAddresses.cidr(config.vpcCidr),
      natGateways: 1,
      subnetConfiguration: [
        { name: "public", subnetType: SubnetType.PUBLIC, cidrMask: 20 },
        { name: "private", subnetType: SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 20 },
        { name: "isolated", subnetType: SubnetType.PRIVATE_ISOLATED, cidrMask: 20 },
      ],
    });
  }
}
