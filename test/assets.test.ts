import * as cdk from "aws-cdk-lib";

import "jest-cdk-snapshot";

import { devConfig } from "../src/config";
import { AssetsStack } from "../src/stack";

test("snapshot for AssetsStack matches previous state", () => {
  const app = new cdk.App();
  const stack = new AssetsStack(app, "MyTestAssetsStack", devConfig);

  expect(stack).toMatchCdkSnapshot({
    ignoreAssets: true,
    ignoreCurrentVersion: true,
    ignoreMetadata: true,
  });
});
