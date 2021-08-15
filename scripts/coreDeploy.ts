import { ethers } from "hardhat";
import { Core } from "../types/Core";

let core: Core;

const main = async () => {
  const signers = await ethers.getSigners();

  console.log("Deploying with default signer", signers[0].address);

  core = (await (await ethers.getContractFactory("Core")).deploy()) as Core;
  await core.deployed();

  console.log("Deployed Core contract to", core.address);
};

main()
  .then(() => process.exit(1))
  .catch((err) => {
    console.log(err);
    process.exit(1);
  });
