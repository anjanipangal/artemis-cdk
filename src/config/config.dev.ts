import type { Config } from "./types";
import { AwsAccount } from "./types";

export const devConfig: Config = {
  env: {
    account: AwsAccount.Development,
    region: "us-east-1",
  },
};
