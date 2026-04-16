// const {expect} = require("chai")
// const hre = require("hardhat");
// const { ethers } = hre; 

// describe("Kaleido",  function () {
//     let Kaleido, kaleido, owner, user1, user2;

//     beforeEach(async () => {
//         [owner, addr1, addr2] = await ethers.getSigners();
//         Kaleido = await ethers.getContractFactory("KaleidoSuperNode");
//         kaleido = await Kaleido.deploy();
//         await kaleido.waitForDeployment();
//         user1 = addr1;
//         user2 = addr2;
//     });

//     it("Should deploy the contract", async () => {
//         expect(await kaleido.getAddress()).to.properAddress;
//     })

//     it("Should not mint token when sale is not open", async () => {
//         await expect(kaleido.mint(1)).to.be.revertedWith("Sale is not active.");
//     })

//     it("Should mint token when sale is open", async () => {
//         await kaleido.connect(owner).flipSaleState();
//         await expect(kaleido.connect(user1).mint(1,{value: ethers.parseEther("0.1")})).to.emit(kaleido, 'TokensMinted');
//     })


//     it("Should not mint when it has exceeded the max mint per wallet", async () => {
//         await kaleido.connect(owner).flipSaleState();

//         // Fetch max mint per wallet limit
//         const maxMint = await kaleido.MAX_MINT_PER_WALLET();
//         console.log("MAX_MINT_PER_WALLET:", maxMint.toString());

//         // First mint
//         await kaleido.connect(user1).mint(1, { value: ethers.parseEther("0.1") });

//         let minted1 = await kaleido.mintedPerWallet(user1.address);
//         console.log("Minted after first mint:", minted1.toString()); // Should be 1

//         // Second mint
//         await kaleido.connect(user1).mint(1, { value: ethers.parseEther("0.1") });

//         let minted2 = await kaleido.mintedPerWallet(user1.address);
//         console.log("Minted after second mint:", minted1.toString()); // Should be 2

//         // This should fail if max mint per wallet is 2
//         await expect(
//             kaleido.connect(user1).mint(1, { value: ethers.parseEther("0.1") })
//         ).to.be.revertedWith("Exceeds max mint per wallet.");
//     });


//     it("Should allow owner to withdraw all funds", async () => {
//         const initialOwnerBalance = await owner.provider.getBalance(owner.address);
    
//         // Define mint price
//         const mintPrice = ethers.parseEther("0.1");
//         await kaleido.connect(owner).flipSaleState();

//         await kaleido.connect(user1).mint(1, { value: mintPrice });

//         // Check contract balance before withdrawal
//         let contractBalanceBefore = await ethers.provider.getBalance(kaleido.getAddress());
//         console.log("Contract Balance Before Withdrawal:", ethers.formatEther(contractBalanceBefore));

//         // Withdraw funds as owner
//         const ownerBalanceBefore = await ethers.provider.getBalance(await owner.getAddress());
//         let tx = await kaleido.connect(owner).withdrawAll(user1, user2);
//         let receipt = await tx.wait();
//         let gasUsed = receipt?.gasUsed * receipt?.gasPrice; // Calculate gas cost
//         let contractBalanceAfter = await ethers.provider.getBalance(kaleido.getAddress());
//         let ownerBalanceAfter = await ethers.provider.getBalance(owner.address);

//         console.log("Contract Balance After Withdrawal:", ethers.formatEther(contractBalanceAfter));
//         console.log("Owner Balance Before:", ethers.formatEther(contractBalanceBefore));
//         console.log("Owner Balance After:", ethers.formatEther(ownerBalanceAfter));

//         // Ensure the contract balance is now zero
//         expect(contractBalanceAfter).to.equal(0);


//     });

//     it("Should not allow non-owner to withdraw funds", async () => {
//         await expect(kaleido.connect(user1).withdrawAll(user2, owner)).to.be.revertedWithCustomError(kaleido, "OwnableUnauthorizedAccount");
//     });



// })