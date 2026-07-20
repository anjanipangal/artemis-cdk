import * as cdk from "aws-cdk-lib";

import { devConfig } from "./config";
import { ArtemisStack } from "./stack";

const app = new cdk.App();

new ArtemisStack(app, "Stack", devConfig);
