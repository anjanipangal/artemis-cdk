import * as cdk from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";

import "jest-cdk-snapshot";

import * as fs from "node:fs";
import * as path from "node:path";

import { devConfig } from "../src/config";
import { ArtemisStack } from "../src/stack";

// [DEV] Test for single stack
test("snapshot for Stack matches previous state", () => {
  const app = new cdk.App();
  const stack = new ArtemisStack(app, "MyTestStack", devConfig);

  expect(stack).toMatchCdkSnapshot({
    ignoreAssets: true,
    ignoreCurrentVersion: true,
    ignoreMetadata: true,
  });
});

test("existing subnets are not replaced (CIDR blocks unchanged)", () => {
  const app = new cdk.App();
  const stack = new ArtemisStack(app, "MyTestStack", devConfig);
  const template = Template.fromStack(stack);

  const subnets = template.findResources("AWS::EC2::Subnet");

  // Create a map of logical ID -> CIDR block
  const currentSubnets: Record<string, string> = {};
  Object.entries(subnets).forEach(([logicalId, resource]) => {
    currentSubnets[logicalId] = resource.Properties?.CidrBlock as string;
  });

  const snapshotPath = path.join(__dirname, "__snapshots__", "subnet-cidrs.json");

  // Initialize if doesn't exist
  if (!fs.existsSync(snapshotPath)) {
    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, JSON.stringify(currentSubnets, null, 2));
    console.log(`✓ Created baseline: ${snapshotPath}`);
    return;
  }

  const baselineSubnets: Record<string, string> = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));

  // Check if any existing subnet's CIDR changed (indicates replacement)
  const changedSubnets: string[] = [];
  Object.entries(baselineSubnets).forEach(([logicalId, cidr]) => {
    if (currentSubnets[logicalId] && currentSubnets[logicalId] !== cidr) {
      changedSubnets.push(`  ${logicalId}: ${cidr} → ${currentSubnets[logicalId]}`);
    }
  });

  // Check for missing subnets (deleted logical IDs)
  const missingSubnets = Object.keys(baselineSubnets).filter((id) => !currentSubnets[id]);

  if (changedSubnets.length > 0 || missingSubnets.length > 0) {
    let errorMsg = `🚨 SUBNET REPLACEMENT DETECTED 🚨\n\n`;

    if (changedSubnets.length > 0) {
      errorMsg += `CIDR blocks changed (requires replacement):\n${changedSubnets.join("\n")}\n\n`;
    }

    if (missingSubnets.length > 0) {
      errorMsg += `Missing subnets:\n${missingSubnets.map((id) => `  - ${id}`).join("\n")}\n\n`;
    }

    errorMsg += `Common causes:\n`;
    errorMsg += `  1. Inserting new subnets in the middle of subnetConfiguration array\n`;
    errorMsg += `  2. Reordering existing subnets\n`;
    errorMsg += `Solution: Always ADD new subnets at the END of the array.\n\n`;
    errorMsg += `If this change is intentional, delete the baseline and regenerate:\n`;
    errorMsg += `  rm ${snapshotPath}\n`;
    errorMsg += `  npm test\n`;

    throw new Error(errorMsg);
  }

  // Auto-update with new additions
  const newSubnets = Object.keys(currentSubnets).filter((id) => !baselineSubnets[id]);

  if (newSubnets.length > 0) {
    console.log(`✓ New subnets detected (safe additions):`);
    newSubnets.forEach((id) => {
      console.log(`    ${id}: ${currentSubnets[id]}`);
    });

    fs.writeFileSync(snapshotPath, JSON.stringify(currentSubnets, null, 2));
    console.log(`✓ Updated: ${snapshotPath}`);
  }
});
