import type { Config } from "./types";
import { AwsAccount } from "./types";

export const devConfig: Config = {
  env: {
    account: AwsAccount.Development,
    region: "us-east-1",
  },
  vpcCidr: "10.0.0.0/16",
};
