import * as cdk from "aws-cdk-lib";

import { devConfig } from "./config";
import { InfraStack, AssetsStack } from "./stack";

const app = new cdk.App();

const assetsStack = new AssetsStack(app, "AssetsStack", devConfig);
new InfraStack(app, "InfraStack", devConfig, assetsStack);
