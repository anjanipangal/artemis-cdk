import type { Construct } from "constructs";
import type { StackProps } from "aws-cdk-lib";
import { Stack, Tags } from "aws-cdk-lib";
import { Vpc, SubnetType, IpAddresses } from "aws-cdk-lib/aws-ec2";

import type { Config } from "../config";
import type { AssetsStack } from "./assets";

export class InfraStack extends Stack {
  readonly vpc: Vpc;

  constructor(scope: Construct, id: string, config: Config, assetsStack: AssetsStack, props?: StackProps) {
    super(scope, id, { ...props, env: config.env });

    Tags.of(this).add("Project", "Artemis");
    Tags.of(this).add("GitRepository", "TBD"); //TODO Fix this once GitHub Repository gets created

    this.vpc = this.createVpc(config);
  }

  private createVpc(config: Config): Vpc {
    return new Vpc(this, "Vpc", {
      ipAddresses: IpAddresses.cidr(config.vpcCidr),
      natGateways: 1,
      subnetConfiguration: [
        { name: "public", subnetType: SubnetType.PUBLIC, cidrMask: 20 },
        { name: "private", subnetType: SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 20 },
      ],
    });
  }
}
