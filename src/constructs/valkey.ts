import { Construct } from "constructs";
import { SubnetType, SecurityGroup, Port, Connections, type IVpc } from "aws-cdk-lib/aws-ec2";
import { CfnReplicationGroup, CfnSubnetGroup } from "aws-cdk-lib/aws-elasticache";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";

import type { Config } from "../config";

interface ValkeyProps {
  config: Config;
  vpc: IVpc;
}

export class Valkey extends Construct {
  readonly authSecret: Secret;
  readonly replicationGroup: CfnReplicationGroup;
  readonly connections: Connections;

  constructor(scope: Construct, id: string, props: ValkeyProps) {
    super(scope, id);

    const { config, vpc } = props;

    this.authSecret = this.createAuthSecret(config);
    const sg = this.createSecurityGroup(vpc);
    this.connections = new Connections({ securityGroups: [sg], defaultPort: Port.tcp(6379) });
    this.replicationGroup = this.createReplicationGroup(config, vpc, sg);
  }

  private createAuthSecret(config: Config): Secret {
    return new Secret(this, "ValkeyAuthSecret", {
      secretName: `${config.environmentName}/livekit/valkey`,
      description: "ValKey AUTH token for LiveKit-to-ValKey connection",
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 32,
      },
    });
  }

  private createSecurityGroup(vpc: IVpc): SecurityGroup {
    return new SecurityGroup(this, "ValkeySecurityGroup", { vpc });
  }

  private createReplicationGroup(config: Config, vpc: IVpc, sg: SecurityGroup): CfnReplicationGroup {
    const { valkey, environmentName } = config;

    const subnets = vpc.selectSubnets({ subnetType: SubnetType.PRIVATE_WITH_EGRESS });

    const subnetGroup = new CfnSubnetGroup(this, "ValkeySubnetGroup", {
      description: `${environmentName} LiveKit ValKey subnet group`,
      subnetIds: subnets.subnetIds,
      cacheSubnetGroupName: `${environmentName}-livekit-valkey`,
    });

    return new CfnReplicationGroup(this, "ValkeyReplicationGroup", {
      replicationGroupDescription: `${environmentName} LiveKit ValKey`,
      replicationGroupId: `${environmentName}-livekit-valkey`,
      engine: "valkey",
      engineVersion: valkey.engineVersion,
      cacheNodeType: valkey.nodeType,
      numNodeGroups: 1,
      replicasPerNodeGroup: valkey.numReplicas,
      transitEncryptionEnabled: true,
      atRestEncryptionEnabled: true,
      automaticFailoverEnabled: valkey.numReplicas > 0,
      authToken: this.authSecret.secretValue.unsafeUnwrap(),
      securityGroupIds: [sg.securityGroupId],
      cacheSubnetGroupName: subnetGroup.ref,
    });
  }
}
