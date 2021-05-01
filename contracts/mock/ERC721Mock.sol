// SPDX-License-Identifier: MIT

pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract ERC721Mock is ERC721 {
  uint256 public currentTokenId = 1;

  constructor () ERC721("Test Token", "TT") {}

  function mint() external {
    uint256 tokenId = currentTokenId;

    currentTokenId++;

    _mint(msg.sender, tokenId);
  }
}
