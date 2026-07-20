import type { Construct } from "constructs";
import type { StackProps } from "aws-cdk-lib";
import { Stack, Tags } from "aws-cdk-lib";

import type { Config } from "../config";
import type { AssetsStack } from "./assets";

export class InfraStack extends Stack {
  constructor(scope: Construct, id: string, config: Config, assetsStack: AssetsStack, props?: StackProps) {
    super(scope, id, { ...props, env: config.env });

    Tags.of(this).add("Project", "Artemis");
    Tags.of(this).add("GitRepository", "TBD"); //TODO Fix this once GitHub Repository gets created
  }
}
