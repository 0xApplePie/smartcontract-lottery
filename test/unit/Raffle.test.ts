import { deployments, network } from "hardhat";
import { developmentChains, networkConfig } from "../../helper-hardhat-config";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { Raffle , VRFCoordinatorV2Mock} from "../../typechain-types";
import { assert, expect } from "chai";


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





})

function enterRaffle(arg0: { value: number; }): any {
    throw new Error("Function not implemented.");
}
