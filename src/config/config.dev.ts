import type { Config } from "./types";
import { AwsAccount } from "./types";

export const devConfig: Config = {
  env: {
    account: AwsAccount.Development,
    region: "us-west-1",
  },
  vpcCidr: "10.1.0.0/16",
};
