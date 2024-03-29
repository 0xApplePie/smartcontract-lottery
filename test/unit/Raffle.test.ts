import { deployments, network } from "hardhat";
import { developmentChains, networkConfig } from "../../helper-hardhat-config";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { Raffle , VRFCoordinatorV2Mock} from "../../typechain-types";
import { assert, expect } from "chai";
import exp from "constants";


!developmentChains.includes(network.name) ? describe.skip : describe("Raffle Unit test" ,  function () {
    let raffle: Raffle
    let raffleContract: Raffle
    let vrfCoordinatorV2Mock: VRFCoordinatorV2Mock
    let raffleEntranceFee: BigNumber
    let interval: number
    let player: SignerWithAddress
    let accounts: SignerWithAddress[]

    beforeEach(async () => {
        accounts = await ethers.getSigners()
        player = accounts[1]
        await deployments.fixture(["mocks", "raffle"])
        vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock")
        raffleContract = await ethers.getContract("Raffle")
        raffle = raffleContract.connect(player)
        raffleEntranceFee = await raffle.getEntranceFee()
        interval = (await raffle.getInterval()).toNumber()
    })

    describe("constructor", function() {
        it("correctly initalizes", async () =>  {
            console.log(network.config.chainId)
            const raffleState = (await raffle.getRaffleState()).toString()
            assert.equal(raffleState, "0") // Raffle is open
            assert.equal(
                interval.toString(),
                networkConfig[network.config.chainId!]["keepersUpdateInterval"]
            )
            
        })
    })

    describe("enterRaffle", function() {
        it("allows a user to enter the raffle", async () => {
            const entranceFee = await raffle.getEntranceFee()
            await raffle.enterRaffle({ value: entranceFee })
            const playerCount = await raffle.getNumOfPlayers()
            assert.equal(playerCount.toString(), "1")
        })

        it("does not allow a user to enter the raffle without paying the entrance fee", async () => {
            await expect(raffle.enterRaffle( {value:0})).to.be.revertedWith(
                "Raffle__SendMoreToEnterRaffle"
            )
        })

        it("records a player when they enter the raffle", async () => {
            await raffle.enterRaffle({ value: raffleEntranceFee })
            const currentPlayer = await raffle.getPlayer(0)
            assert.equal(currentPlayer, player.address)
        })

        it("emits an event when a player enters the raffle", async () => {
            await expect(raffle.enterRaffle({ value: raffleEntranceFee }))
                .to.emit(raffle, "RaffleEnter")
                .withArgs(player.address)
        })

        it("does not allow a user to enter the raffle if the raffle is closed/calculating", async () => {
            await raffle.enterRaffle({ value: raffleEntranceFee })
            await network.provider.send("evm_increaseTime", [interval+1])
            await network.provider.request({ method: "evm_mine", params: [] })
            await raffle.performUpkeep([])
            await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                    "Raffle__RaffleNotOpen"
                )
        })
    })

    describe("checkUpkeep", function() {
        it("returns true if the raffle is closed/calculating", async () => {
            await raffle.enterRaffle({ value: raffleEntranceFee })
            await network.provider.send("evm_increaseTime", [interval+1])
            await network.provider.request({ method: "evm_mine", params: [] })
            const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x")
            assert.isTrue(upkeepNeeded)
        })

        it("returns false if the raffle is open", async () => {
            const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x")
            assert.isFalse(upkeepNeeded)
        })

        it("returns false if no ETH is sent", async () => {
            await network.provider.send("evm_increaseTime", [interval+1])
            await network.provider.request({ method: "evm_mine", params: [] })
            const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x")
            assert.isFalse(upkeepNeeded)
        })

        it("returns true if enough time has passed, has players, has eth and is open", async () => {
            await raffle.enterRaffle({ value: raffleEntranceFee })
            await network.provider.send("evm_increaseTime", [interval +1])
            await network.provider.request({ method: "evm_mine", params: [] })
            const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x")
            assert.isTrue(upkeepNeeded)
        })
    })

    describe("performUpkeep", function() {
        it("can only run when checkUpkeep returns true", async () => {
            await raffle.enterRaffle({ value: raffleEntranceFee })
            await network.provider.send("evm_increaseTime", [interval+1])
            await network.provider.request({ method: "evm_mine", params: [] })
            const tx = await raffle.performUpkeep("0x")
            assert(tx)
        })

        it("does not allow upkeep if the raffle is open", async () => {
            await expect(raffle.performUpkeep("0x")).to.be.revertedWith(
                "Raffle__UpkeepNotNeeded"
            )
        })

        it("updates the raffle state and emits a request id", async () => {
            await raffle.enterRaffle({ value: raffleEntranceFee })
            await network.provider.send("evm_increaseTime", [interval+1])
            await network.provider.request({ method: "evm_mine", params: [] })
            const tx = await raffle.performUpkeep("0x")
            const txReceipt = await tx.wait(1)
            const raffleState = await raffle.getRaffleState()
            const requestId = txReceipt.events![1].args!.requestId
            assert(requestId.toNumber() > 0)
            assert(raffleState == 1) // Raffle is calculating
        })
    })

    describe("fulfillRandomWord", function() {
        beforeEach(async () => {
                await raffle.enterRaffle({ value: raffleEntranceFee })
                await network.provider.send("evm_increaseTime", [interval + 1])
                await network.provider.request({ method: "evm_mine", params: [] })
            })

        it("can only be called after the performUpkeep function", async () => {
            await expect(vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)).to.be.revertedWith(
                "nonexistent request")
            await expect(vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)).to.be.revertedWith(
                "nonexistent request")
            })

        it("selects a winner, resets lottery and sends money", async () => {
            const additionalEntrances = 3
            const startingIndex = 2
            for (let i = startingIndex; i < startingIndex + additionalEntrances; i++) {
                raffle = raffleContract.connect(accounts[i])
                await raffle.enterRaffle({ value: raffleEntranceFee })
            }
            const startingTimeStamp = await raffle.getLastTimestamp()

            await new Promise<void> (async (resolve,reject) => {
                raffle.once("WinnerPicked", async () => {
                    console.log("WinnerPicked")
                    try{
                        const recentWinner = await raffle.getRecentWinner()
                        const raffleState = await raffle.getRaffleState()
                        const endingTimeStamp = await raffle.getLastTimestamp()
                        const winnerBalance = await accounts[2].getBalance()
                        const playerCount = await raffle.getNumOfPlayers()
                        await expect(raffle.getPlayer(0)).to.be.reverted
                        assert.equal(recentWinner.toString(), accounts[2].address)
                        assert.equal(raffleState, 0)
                        assert.equal(
                            winnerBalance.toString(),
                            startingBalance
                                .add(
                                    raffleEntranceFee
                                        .mul(additionalEntrances)
                                        .add(raffleEntranceFee)
                                )
                                .toString()
                        )
                        assert(endingTimeStamp > startingTimeStamp)
                        resolve()
                    }catch (e) {
                        reject(e)
                    }
                })


                const tx = await raffle.performUpkeep("0x")
                const txReceipt = await tx.wait(1)
                const startingBalance = await accounts[2].getBalance()
                await vrfCoordinatorV2Mock.fulfillRandomWords(
                    txReceipt!.events![1].args!.requestId,
                    raffle.address)
            })


        })

    })



})