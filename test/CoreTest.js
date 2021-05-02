describe("Core", async () => {
  const { expect } = require("chai");

  let core, erc721Factory, tradeId;

  let coreInstance, erc721Instance, owner, acc;

  beforeEach("deploy instances", async () => {
    core = await ethers.getContractFactory("Core");
    erc721Factory = await ethers.getContractFactory("ERC721Mock");
    tradeId = ethers.utils.formatBytes32String("myTradeId");

    coreInstance = await core.deploy();
    await coreInstance.deployed();

    erc721Instance = await erc721Factory.deploy();
    await erc721Instance.deployed();
  });

  beforeEach("setup tests state", async () => {
    [owner, ...acc] = await ethers.getSigners();
  });

  describe("startTrade", async () => {
    it("should start a trade", async () => {
      let tx = await startTradeSetup();

      tx = await tx.wait();

      expect(tx.events[0].event).to.equal("TradeStarted");
    });

    it("should return trade information", async () => {
      await startTradeSetup();

      let tradeInfo = await coreInstance.getTrade(tradeId);

      expect(tradeInfo[0]).to.equal(owner.address);
      expect(tradeInfo[1]).to.equal(acc[1].address);
      expect(tradeInfo[2]).to.equal(erc721Instance.address);
      expect(tradeInfo[3]).to.equal(erc721Instance.address);
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
      it("should make contract owner of the token", async () => {
        await coreInstance.connect(acc[1]).addTokenToTrade(tradeId, 2, 1);

        // Token should be sent from owner to the contract
        expect(await erc721Instance.ownerOf(2)).to.equal(coreInstance.address);
      });
    });

    describe("reverts", async () => {
      it("should revert if cell is 0", async () => {
        await expect(
          coreInstance.addTokenToTrade(tradeId, 1, 0)
        ).to.be.revertedWith("Core: cannot use cell 0");
      });

      it("should revert if token cell not available", async () => {
        await coreInstance.addTokenToTrade(tradeId, 1, 1);

        await expect(
          coreInstance.connect(acc[1]).addTokenToTrade(tradeId, 2, 1)
        ).to.be.revertedWith("Core: token cell not available");
      });

      it("should revert if not owner of token sends tx", async () => {
        await expect(
          coreInstance.addTokenToTrade(tradeId, 2, 4)
        ).to.be.revertedWith("Core: not owner of token");
      });

      it("should revert if we are not approved", async () => {
        await erc721Instance.approve(acc[2].address, 1);

        await expect(
          coreInstance.addTokenToTrade(tradeId, 1, 10)
        ).to.be.revertedWith("Core: contract not approved");
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
      await coreInstance.addTokenToTrade(tradeId, 1, 3);
      await coreInstance.connect(acc[1]).addTokenToTrade(tradeId, 2, 1);
    });

    describe("valid operation", async () => {
      it("should make user ready to trade", async () => {
        await expect(await coreInstance.changeUserReadiness(tradeId, true))
          .to.emit(coreInstance, "UserTradeStateChange")
          .withArgs(tradeId, owner.address, true);
      });

      it("should finalize trade when both users are ready", async () => {
        await coreInstance.changeUserReadiness(tradeId, true);
        let tx = await coreInstance
          .connect(acc[1])
          .changeUserReadiness(tradeId, true);

        await expect(tx)
          .to.emit(coreInstance, "TradeFinalized")
          .withArgs(tradeId);

        let trade = await coreInstance.getTrade(tradeId);
        expect(trade[5]).to.equal(2);
      });

      it("should send all tokens to users involved", async () => {
        // Create two more tokens and include them all in the current trade
        await erc721Instance.mint();
        await erc721Instance.approve(coreInstance.address, 3);
        await coreInstance.addTokenToTrade(tradeId, 3, 4);

        await erc721Instance.connect(acc[1]).mint();
        await erc721Instance.connect(acc[1]).approve(coreInstance.address, 4);
        await coreInstance.connect(acc[1]).addTokenToTrade(tradeId, 4, 5);

        await coreInstance.changeUserReadiness(tradeId, true);
        await coreInstance.connect(acc[1]).changeUserReadiness(tradeId, true);

        // Token 1 and 3 should be under 'acc[1]' ownership
        expect(await erc721Instance.ownerOf(1)).to.equal(acc[1].address);
        expect(await erc721Instance.ownerOf(3)).to.equal(acc[1].address);

        // Token 2 and 4 should be under 'owner' ownership
        expect(await erc721Instance.ownerOf(2)).to.equal(owner.address);
        expect(await erc721Instance.ownerOf(4)).to.equal(owner.address);
      });

      it("should be able to mark the user as un-ready", async () => {
        await coreInstance.changeUserReadiness(tradeId, true);

        expect(await coreInstance.changeUserReadiness(tradeId, false))
          .to.emit(coreInstance, "UserTradeStateChange")
          .withArgs(tradeId, owner.address, false);
      });
    });
  });

  const startTradeSetup = async (cellNumber = 12) => {
    return coreInstance.startTrade(
      tradeId,
      owner.address,
      acc[1].address,
      erc721Instance.address,
      erc721Instance.address,
      cellNumber
    );
  };

  const approveTokens = async (token1, token2) => {
    await erc721Instance.approve(coreInstance.address, token1);
    await erc721Instance.connect(acc[1]).approve(coreInstance.address, token2);
  };

  const createTwoTokens = async () => {
    await erc721Instance.mint();
    await erc721Instance.connect(acc[1]).mint();
  };
})
