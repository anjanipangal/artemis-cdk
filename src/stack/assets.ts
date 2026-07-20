import type { Construct } from "constructs";
import type { StackProps } from "aws-cdk-lib";
import { Stack, Tags, RemovalPolicy } from "aws-cdk-lib";
import { Repository, TagMutability } from "aws-cdk-lib/aws-ecr";

import type { Config } from "../config";

export class AssetsStack extends Stack {
  readonly repository: Repository;

  constructor(scope: Construct, id: string, config: Config, props?: StackProps) {
    super(scope, id, { ...props, env: config.env });

    Tags.of(this).add("Project", "Artemis");
    Tags.of(this).add("GitRepository", "TBD"); //TODO Fix this once GitHub Repository gets created

    this.repository = new Repository(this, "Repository", {
      repositoryName: "artemis",
      imageTagMutability: TagMutability.IMMUTABLE,
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}
