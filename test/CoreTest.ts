import { expect } from "chai";
import { ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Core } from "../types/Core";
import { ERC721Mock } from "../types/ERC721Mock";

const tradeId = ethers.utils.formatBytes32String("myTradeId");

describe("Core", () => {
  let core: Core;
  let erc721: ERC721Mock;
  let acc: SignerWithAddress[];
  let owner: SignerWithAddress;

  before("populate accs", async () => {
    [owner, ...acc] = await ethers.getSigners();
  });

  beforeEach("deploy instances", async () => {
    core = (await (await ethers.getContractFactory("Core")).deploy()) as Core;
    await core.deployed();

    erc721 = (await (
      await ethers.getContractFactory("ERC721Mock")
    ).deploy()) as ERC721Mock;
    await erc721.deployed();
  });

  describe("startTrade", async () => {
    it("should start a trade", async () => {
      let tx = await startTradeSetup();
      let receipt = await tx.wait();

      expect(receipt.events[0].event).to.equal("TradeStarted");
    });

    it("should return trade information", async () => {
      await startTradeSetup();

      let tradeInfo = await core.getTrade(tradeId);

      expect(tradeInfo[0]).to.equal(owner.address);
      expect(tradeInfo[1]).to.equal(acc[0].address);
      expect(tradeInfo[2]).to.equal(erc721.address);
      expect(tradeInfo[3]).to.equal(erc721.address);
      expect(tradeInfo[4]).to.equal(12);
      expect(tradeInfo[5]).to.equal(1);
    });

    describe("reverts", async () => {
      it("should revert if trade has been started already", async () => {
        await startTradeSetup();

        await expect(startTradeSetup()).to.be.revertedWith(
          "Core: trade already exists"
        );
      });
    });
  });

  describe("addTokenToTrade", async () => {
    beforeEach("create token and send to accounts", async () => {
      await createTwoTokens();
    });

    beforeEach("approves contract for token", async () => {
      await approveTokens(1, 2);
    });

    beforeEach("creates trade", async () => {
      await startTradeSetup();
    });

    describe("valid appending", async () => {
      it("should transfer token to contract and notify", async () => {
        await expect(core.connect(acc[0]).addTokenToTrade(tradeId, 2, 1))
          .to.emit(core, "TokenAddedToTrade")
          .withArgs(tradeId, acc[0].address, 2, 1);

        // Token should be sent from owner to the contract
        expect(await erc721.ownerOf(2)).to.equal(core.address);
      });
    });

    describe("reverts", async () => {
      it("should revert if cell is 0", async () => {
        await expect(core.addTokenToTrade(tradeId, 1, 0)).to.be.revertedWith(
          "Core: cannot use cell 0"
        );
      });

      it("should revert if token cell not available", async () => {
        await core.addTokenToTrade(tradeId, 1, 1);

        await expect(
          core.connect(acc[0]).addTokenToTrade(tradeId, 2, 1)
        ).to.be.revertedWith("Core: token cell not available");
      });

      it("should revert if not owner of token sends tx", async () => {
        await expect(core.addTokenToTrade(tradeId, 2, 4)).to.be.revertedWith(
          "Core: not owner of token"
        );
      });

      it("should revert if we are not approved", async () => {
        await erc721.approve(acc[2].address, 1);

        await expect(core.addTokenToTrade(tradeId, 1, 10)).to.be.revertedWith(
          "Core: contract not approved"
        );
      });
    });
  });

  describe("removeTokenFromTrade", async () => {
    beforeEach("create token and send to accounts", async () => {
      await createTwoTokens();
    });

    beforeEach("approves contract for token", async () => {
      await approveTokens(1, 2);
    });

    beforeEach("creates trade", async () => {
      await startTradeSetup();
    });

    beforeEach("add token to trade", async () => {
      await core.addTokenToTrade(tradeId, 1, 1);
      await core.connect(acc[0]).addTokenToTrade(tradeId, 2, 3);
    });

    describe("valid removal", async () => {
      it("should remove a token from a trade and transfer to user", async () => {
        await expect(core.addTokenToTrade(tradeId, 1, 1)).to.be.reverted;

        await expect(core.removeTokenFromTrade(tradeId, 1))
          .to.emit(core, "TokenRemovedFromTrade")
          .withArgs(tradeId, owner.address, 1, 1);

        expect(await erc721.ownerOf(1)).to.equal(owner.address);
      });

      it("should allow a new horse to be put under the removed cell", async () => {
        await core.removeTokenFromTrade(tradeId, 1);

        // acc[0] is the owner of token ID 4
        await createTwoTokens();

        // Approves the same token as it was removed
        await erc721.connect(acc[0]).approve(core.address, 4);

        await expect(core.connect(acc[0]).addTokenToTrade(tradeId, 4, 1))
          .to.emit(core, "TokenAddedToTrade")
          .withArgs(tradeId, acc[0].address, 4, 1);
      });
    });

    describe("reverts", async () => {
      it("should revert if horse is not registered", async () => {
        await expect(core.removeTokenFromTrade(tradeId, 4)).to.be.revertedWith(
          "Core: no token found for cell"
        );
      });

      it("should revert if not the owner tries to remove a token from the trade", async () => {
        await expect(
          core.connect(acc[0]).removeTokenFromTrade(tradeId, 1)
        ).to.be.revertedWith("Core: unauthorized signer");
      });
    });
  });

  describe("changeUserReadiness", async () => {
    beforeEach("create token and send to accounts", async () => {
      await createTwoTokens();
    });

    beforeEach("approves contract for token", async () => {
      await approveTokens(1, 2);
    });

    beforeEach("creates trade", async () => {
      await startTradeSetup();
    });

    beforeEach("adds token to trade", async () => {
      await core.addTokenToTrade(tradeId, 1, 3);
      await core.connect(acc[0]).addTokenToTrade(tradeId, 2, 1);
    });

    describe("valid operation", async () => {
      it("should make user ready to trade", async () => {
        await expect(await core.changeUserReadiness(tradeId, true))
          .to.emit(core, "UserTradeStateChange")
          .withArgs(tradeId, owner.address, true);
      });

      it("should finalize trade when both users are ready", async () => {
        await core.changeUserReadiness(tradeId, true);
        let tx = await core.connect(acc[0]).changeUserReadiness(tradeId, true);

        await expect(tx).to.emit(core, "TradeFinalized").withArgs(tradeId);

        let trade = await core.getTrade(tradeId);
        expect(trade[5]).to.equal(2);
      });

      it("should send all tokens to users involved", async () => {
        // Create two more tokens and include them all in the current trade
        await erc721.mint();
        await erc721.approve(core.address, 3);
        await core.addTokenToTrade(tradeId, 3, 4);

        await erc721.connect(acc[0]).mint();
        await erc721.connect(acc[0]).approve(core.address, 4);
        await core.connect(acc[0]).addTokenToTrade(tradeId, 4, 5);

        await core.changeUserReadiness(tradeId, true);
        await core.connect(acc[0]).changeUserReadiness(tradeId, true);

        // Token 1 and 3 should be under 'acc[0]' ownership
        expect(await erc721.ownerOf(1)).to.equal(acc[0].address);
        expect(await erc721.ownerOf(3)).to.equal(acc[0].address);

        // Token 2 and 4 should be under 'owner' ownership
        expect(await erc721.ownerOf(2)).to.equal(owner.address);
        expect(await erc721.ownerOf(4)).to.equal(owner.address);
      });

      it("should be able to mark the user as un-ready", async () => {
        await core.changeUserReadiness(tradeId, true);

        expect(await core.changeUserReadiness(tradeId, false))
          .to.emit(core, "UserTradeStateChange")
          .withArgs(tradeId, owner.address, false);
      });
    });
  });

  const startTradeSetup = async (cellNumber = 12) => {
    return core.startTrade(
      tradeId,
      owner.address,
      acc[0].address,
      erc721.address,
      erc721.address,
      cellNumber
    );
  };

  const approveTokens = async (token1, token2) => {
    await erc721.approve(core.address, token1);
    await erc721.connect(acc[0]).approve(core.address, token2);
  };

  const createTwoTokens = async () => {
    await erc721.mint();
    await erc721.connect(acc[0]).mint();
  };
});
