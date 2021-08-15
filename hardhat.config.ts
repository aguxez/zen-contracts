import "@nomiclabs/hardhat-solhint";
import "@nomiclabs/hardhat-waffle";
import "solidity-coverage";
import { runTypeChain, glob } from "typechain";
import { HardhatUserConfig, task } from "hardhat/config";
import { TASK_COMPILE } from "hardhat/builtin-tasks/task-names";

// This is a sample Hardhat task. To learn how to create your own go to
// https://hardhat.org/guides/create-task.html
task("accounts", "Prints the list of accounts", async (_taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(account.address);
  }
});

// You need to export an object to set up your config
// Go to https://hardhat.org/config/ to learn more

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
const config: HardhatUserConfig = {
  solidity: "0.7.6",
};

task(TASK_COMPILE, async (args, { config: { paths } }, runSuper) => {
  await runSuper(args);
  const allFiles = glob(paths.root, [
    `${paths.artifacts}/!(build-info)/**/+([a-zA-Z0-9_]).json`,
  ]);
  await runTypeChain({
    allFiles,
    cwd: paths.root,
    outDir: "types",
    target: "ethers-v5",
    filesToProcess: allFiles,
  });
});

export default config;
