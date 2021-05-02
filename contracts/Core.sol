// SPDX-License-Identifier: MIT

pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC721/ERC721Holder.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "hardhat/console.sol";

contract Core is Context, ERC721Holder {
    // Tracks initial state of trade;
    mapping(bytes32 => Trade) private _trades;

    // Tracks the contract that an user started a trade with
    mapping(bytes32 => mapping(address => ContractTracker)) private _contractsTracker;

    // Maps cell (number) to a token ID for easy retrieval
    mapping(bytes32 => mapping(uint256 => uint256)) private _cellToTokenId;

    // Tracks whether or not an user is ready to trade
    mapping(bytes32 => mapping(address => bool)) private _isUserReadyToTrade;

    // Tracks a token ID to an user address in a trade
    mapping(bytes32 => mapping(uint256 => address)) private _tokenToUserAddress;

    struct Trade {
        address starter;
        address receiver;
        IERC721 starterContract;
        IERC721 receiverContract;
        uint256 amountOfCells;
        TradeState state;
    }

    struct ContractTracker {
        address user;
        IERC721 tokenContract;
    }

    event TradeStarted(
        bytes32 indexed _tradeId,
        address _starter,
        address _receiver,
        IERC721 _starterContract,
        IERC721 _receiverContract
    );

    event TokenAddedToTrade(
        bytes32 indexed _tradeId,
        address _owner,
        uint256 _tokenId,
        uint256 _cell
    );

    event TokenRemovedFromTrade(
        bytes32 indexed _tradeId,
        address _owner,
        uint256 _tokenId,
        uint256 _cell
    );

    event TradeExtended(bytes32 indexed _tradeId, address _owner, uint256 _tokenId);
    event TradeFinalized(bytes32 _tradeId);
    event UserTradeStateChange(bytes32 indexed _tradeId, address _user, bool _isReady);

    enum TradeState { NULL, STARTED, FINALIZED }

    function startTrade(
        bytes32 _tradeId,
        address _starter,
        address _receiver,
        IERC721 _starterContractAddress,
        IERC721 _receiverContractAddress,
        uint256 _amountOfCells
    ) external {
        require(_trades[_tradeId].state == TradeState.NULL, "Core: trade already exists");

        Trade memory trade;
        trade.starter = _starter;
        trade.receiver = _receiver;
        trade.starterContract = _starterContractAddress;
        trade.receiverContract = _receiverContractAddress;
        trade.amountOfCells = _amountOfCells;
        trade.state = TradeState.STARTED;

        _trades[_tradeId] = trade;

        ContractTracker memory starterContractTracker = ContractTracker(_starter, _starterContractAddress);
        ContractTracker memory receiverContractTracker = ContractTracker(_starter, _starterContractAddress);

        _contractsTracker[_tradeId][_starter] = starterContractTracker;
        _contractsTracker[_tradeId][_receiver] = receiverContractTracker;

        emit TradeStarted(_tradeId, _starter, _receiver, _starterContractAddress, _receiverContractAddress);
    }

    function addTokenToTrade(bytes32 _tradeId, uint256 _tokenId, uint256 _cell) external {
        ContractTracker memory userTracker = _contractsTracker[_tradeId][_msgSender()];
        Trade memory trade = _trades[_tradeId];
        uint256 tokenIdInCell = _cellToTokenId[_tradeId][_cell];

        // Pre-checks
        require(_cell > 0, "Core: cannot use cell 0");
        require(_cell <= trade.amountOfCells, "Core: cell cannot be more than max number of cells");
        require(tokenIdInCell == 0, "Core: token cell not available");
        require(_ownerOfToken(_msgSender(), _tokenId, userTracker.tokenContract), "Core: not owner of token");
        require(_weAreApproved(userTracker.tokenContract, _tokenId), "Core: contract not approved");
        require(_trades[_tradeId].state == TradeState.STARTED, "Core: trade has already finalized");

        // Starts tracking a token ID to an user in a trade
        _tokenToUserAddress[_tradeId][_tokenId] = _msgSender();

        // Starts tracking a cell in a trade ID
        _cellToTokenId[_tradeId][_cell] = _tokenId;

        // Transfers token from the user to us
        userTracker.tokenContract.safeTransferFrom(_msgSender(), address(this), _tokenId);

        emit TokenAddedToTrade(_tradeId, _msgSender(), _tokenId, _cell);
    }

    function removeTokenFromTrade(bytes32 _tradeId, uint256 _cell) external {
        uint256 tokenIdInCell = _cellToTokenId[_tradeId][_cell];

        // Pre-checks
        require(tokenIdInCell != 0, "Core: no token found for cell");
        require(_tokenToUserAddress[_tradeId][tokenIdInCell] == _msgSender(), "Core: unauthorized signer");

        // Cleans state for this token
        delete _cellToTokenId[_tradeId][_cell];
        delete _tokenToUserAddress[_tradeId][tokenIdInCell];

        // Transfers to caller
        ContractTracker memory userContract = _contractsTracker[_tradeId][_msgSender()];

        userContract.tokenContract.safeTransferFrom(address(this), _msgSender(), tokenIdInCell);

        emit TokenRemovedFromTrade(_tradeId, _msgSender(), tokenIdInCell, _cell);
    }

    function changeUserReadiness(bytes32 _tradeId, bool _state) external {
        Trade storage trade = _trades[_tradeId];

        // This returns the check boolean we need to use in the require depending on the `_state`
        // argument
        bool userState = _state
            ? !_isUserReadyToTrade[_tradeId][_msgSender()]
            : _isUserReadyToTrade[_tradeId][_msgSender()];

        // Pre-checks
        require(_msgSender() == trade.starter || _msgSender() == trade.receiver, "Core: user not involved in trade");
        require(userState, "Core: user is ready to trade already");
        require(trade.state == TradeState.STARTED, "Core: trade has already finalized");

        // User finalized trade already
        _isUserReadyToTrade[_tradeId][_msgSender()] = _state;

        if (_state) {
            _maybeTransferTokens(_tradeId, trade);
        }

        emit UserTradeStateChange(_tradeId, _msgSender(), _state);
    }

    function getTrade(bytes32 _tradeId)
        external view
        returns (address, address, IERC721, IERC721, uint256, TradeState) {
            Trade memory trade = _trades[_tradeId];

            return (
                trade.starter,
                trade.receiver,
                trade.starterContract,
                trade.receiverContract,
                trade.amountOfCells,
                trade.state
            );
    }

    function _ownerOfToken(address _user, uint256 _tokenId, IERC721 _contract) private view returns(bool) {
        return _contract.ownerOf(_tokenId) == _user;
    }

    function _weAreApproved(IERC721 _contract, uint256 _tokenId) private view returns(bool) {
        return _contract.getApproved(_tokenId) == address(this);
    }

    function _maybeTransferTokens(bytes32 _tradeId, Trade storage _trade) private {
        // If both users have accepted already we're going to send all the tokens that are being tracked
        bool isStartedReady = _isUserReadyToTrade[_tradeId][_trade.starter];
        bool isReceiverReady = _isUserReadyToTrade[_tradeId][_trade.receiver];

        if (isStartedReady && isReceiverReady) {
            _trade.state = TradeState.FINALIZED;

            _verifyAndSendTokens(_tradeId, _trade);

            emit TradeFinalized(_tradeId);
        }
    }

    function _verifyAndSendTokens(bytes32 _tradeId, Trade memory _trade) private {
        // Takes max number of cells in a trade and loops through them
        for (uint256 i = 1; i <= _trade.amountOfCells; i++) {
            uint256 tokenId = _cellToTokenId[_tradeId][i];
            address tokenOwner = _tokenToUserAddress[_tradeId][tokenId];

            // If it is 0 then no token was put in this cell
            if (tokenId != 0) {
                _sendTokenToAddress(_trade, tokenId, tokenOwner);
            }
        }
    }

    function _sendTokenToAddress(Trade memory _trade, uint256 _tokenId, address _tokenOwner) private {
        // Will check to which account the token should be sent to.
        if (_tokenOwner == _trade.starter) {
            _trade.starterContract.safeTransferFrom(address(this), _trade.receiver, _tokenId);
        } else if (_tokenOwner == _trade.receiver) {
            _trade.receiverContract.safeTransferFrom(address(this), _trade.starter, _tokenId);
        }
    }
}
