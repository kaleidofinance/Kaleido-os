const ethers = require('ethers');

function getSelector(signature) {
    const selector = ethers.id(signature).slice(0, 10);
    console.log(`${signature}: ${selector}`);
}

getSelector("initialize(address,address,uint32)");
getSelector("initialize(address,address)");
getSelector("createPair(address,address,uint32)");
getSelector("createPair(address,address)");
getSelector("ERC20InsufficientBalance(address,uint256,uint256)");
getSelector("ERC20InsufficientAllowance(address,uint256,uint256)");
getSelector("ERC20InvalidReceiver(address)");
getSelector("ERC20InvalidSender(address)");
getSelector("ERC20InvalidApprover(address)");
getSelector("ERC20InvalidSpender(address)");
getSelector("InvalidInitialization()");
getSelector("NotInitializing()");
getSelector("FailedDeployment()");
getSelector("InsufficientLiquidity()");
getSelector("InsufficientLiquidityBurned()");
getSelector("InsufficientLiquidityMinted()");
getSelector("Restricted()");
getSelector("Unauthorized()");
getSelector("SafeTransferFailed()");
getSelector("TransferFailed()");
getSelector("DeploymentFailed()");
getSelector("Forbidden()");
getSelector("IdenticalAddresses()");
