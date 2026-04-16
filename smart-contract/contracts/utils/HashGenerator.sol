pragma solidity ^0.8.0;

contract HashGenerator {
    function getHash() external pure returns (bytes32) {
        return keccak256(abi.encodePacked("kaleido.KLD.totalShares"));
    }
}
