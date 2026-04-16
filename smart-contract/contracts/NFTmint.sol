// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Strings.sol";


contract KaleidoSuperNode is ERC721, Ownable {
    using Strings for uint256; 

    // State Variables
    uint256 public price = 260000000000000;
    uint256 public constant MAX_MINT_PER_TX = 10;
    uint256 public constant MAX_MINT_PER_WALLET = 2;
    bool public isSaleActive;
    uint256 public totalSupply;
    string public baseUri;
    string public baseExtension = ".json";

    mapping(address => uint256) public mintedPerWallet;

    // Events
    event TokensMinted(address indexed owner, uint256 quantity, uint256 totalCost);
    event SaleStateChanged(bool isActive);
    event BaseUriUpdated(string newBaseUri);
    event PriceUpdated(uint256 newPrice);
    event Withdrawal(address indexed recipientOne, address indexed recipientTwo, uint256 amountOne, uint256 amountTwo);


    receive() external payable {}



    constructor() ERC721("Kaleido SuperNode XVD26F", "KSN") Ownable(msg.sender) {
        baseUri = "ipfs://bafybeid2kqefjbd2kp4hozar4e2evtflqgykajs42uxeocs3ri4ieajzaa/";
    }

    /**
     * @dev Mints `_numTokens` NFTs to the caller.
     * @param _numTokens The number of tokens to mint.
     */
    function mint(uint256 _numTokens) external payable {
        require(isSaleActive, "Sale is not active.");
        require(_numTokens > 0, "Must mint at least one token.");
        require(_numTokens <= MAX_MINT_PER_TX, "Exceeds max mint per transaction.");
        require(mintedPerWallet[msg.sender] + _numTokens <= MAX_MINT_PER_WALLET, "Exceeds max mint per wallet.");

        uint256 totalCost = _numTokens * price;
        require(msg.value >= totalCost, "Insufficient funds.");

        uint256 currentTokenId = totalSupply; 
        unchecked {
            for (uint256 i = 0; i < _numTokens; i++) {
                _safeMint(msg.sender, currentTokenId + i);
            }
        }

  
        mintedPerWallet[msg.sender] += _numTokens;
        totalSupply += _numTokens;

        emit TokensMinted(msg.sender, _numTokens, totalCost);
    }


    /**
     * @dev Toggles the sale state.
     */
    function flipSaleState() external onlyOwner {
        isSaleActive = !isSaleActive;
        emit SaleStateChanged(isSaleActive);
    }

    /**
     * @dev Updates the base URI for token metadata.
     * @param _baseUri The new base URI.
     */
    function setBaseUri(string memory _baseUri) external onlyOwner {
        baseUri = _baseUri;
        emit BaseUriUpdated(_baseUri);
    }

    /**
     * @dev Updates the price per token.
     * @param _price The new price in wei.
     */
    function setPrice(uint256 _price) external onlyOwner {
        price = _price;
        emit PriceUpdated(_price);
    }

    /**
     * @dev Withdraws contract balance to two recipients.
     * @param recipientOne The first recipient address.
     * @param recipientTwo The second recipient address.
     */
    function withdrawAll(address payable recipientOne, address payable recipientTwo) external onlyOwner {
        require(recipientOne != address(0) && recipientTwo != address(0), "Invalid recipient address.");

        uint256 balance = address(this).balance;
        require(balance > 0, "No balance to withdraw.");

        uint256 balanceOne = balance / 2;
        uint256 balanceTwo = balance - balanceOne;

        (bool successOne, ) = recipientOne.call{value: balanceOne}("");
        (bool successTwo, ) = recipientTwo.call{value: balanceTwo}("");
        require(successOne && successTwo, "Transfer failed.");

        emit Withdrawal(recipientOne, recipientTwo, balanceOne, balanceTwo);
    }

    /**
     * @dev Returns the token URI for a given token ID.
     * @param tokenId The token ID.
     * @return The token URI.
     */
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
      require(_ownerOf(tokenId) != address(0), "ERC721Metadata: URI query for nonexistent token");


        string memory currentBaseURI = _baseURI();
        return bytes(currentBaseURI).length > 0
            ? string(abi.encodePacked(currentBaseURI, tokenId.toString(), baseExtension))
            : "";
    }

    /**
     * @dev Returns the base URI for token metadata.
     * @return The base URI.
     */
    function _baseURI() internal view override returns (string memory) {
        return baseUri;
    }
}
