import { getFullnodeUrl, SuiClient } from '@mysten/sui.js/client';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { TransactionBlock } from '@mysten/sui.js/transactions';
import BigNumber from 'bignumber.js';
import fs from 'fs';
import { Twisters } from "twisters";
import readlineSync from 'readline-sync';
import chalk from 'chalk';
import delay from 'delay';
import { getCoinOfValue } from "@polymedia/suits";
import clear from 'clear';

const CLAIM_PACKAGE_ID = '0x1efaf509c9b7e986ee724596f526a22b474b15c376136772c00b8452f204d2d1';
const CLAIM_OBJECT_ID = '0x4846a1f1030deffd9dea59016402d832588cf7e0c27b9e4c1a63d2b5e152873a';
const OCEAN_PACKAGE_ID = '0xa8816d3a6e3136e86bc2873b1f94a15cadc8af2703c075f2d546c2ae367f4df9';
const OCEAN_COIN_TYPE = `${OCEAN_PACKAGE_ID}::ocean::OCEAN`;

const _client = new SuiClient({
    url: getFullnodeUrl('mainnet'),
});

function calculateBalance(totalBalance, divider) {
    return Number(totalBalance) / Math.pow(10, divider);
};

function reverseCalculateBalance(balance, multiplier) {
    return balance * Math.pow(10, multiplier);
};

const checkCanUpgrade = async (suiAddress, coinType, upgradePrice, transactionBuilder) => {
    if (coinType === "0x2::sui::SUI") {
        const [splitCoin] = transactionBuilder.splitCoins(transactionBuilder.gas, [transactionBuilder.pure(upgradePrice)]);
        return splitCoin;
    }

    let totalBalance = new BigNumber(0);
    let coinResponse;
    let cursor;
    let foundSufficientBalance = false;
    const coinObjectIds = [];

    do {
        coinResponse = await _client.getCoins({
            owner: suiAddress,
            coinType: coinType,
            cursor: cursor
        });

        if (!coinResponse || !coinResponse.data.length) break;

        if (totalBalance.lt(upgradePrice)) {
            for (let i = 0; i < coinResponse.data.length; i++) {
                totalBalance = totalBalance.plus(coinResponse.data[i].balance);
                coinObjectIds.push(transactionBuilder.object(coinResponse.data[i].coinObjectId));

                if (totalBalance.gte(upgradePrice)) {
                    foundSufficientBalance = true;
                    break;
                }
            }
        }

        cursor = coinResponse.nextCursor;
    } while (coinResponse.hasNextPage && !foundSufficientBalance);

    if (!totalBalance.lt(upgradePrice) && coinObjectIds.length) {
        const primaryCoinObject = transactionBuilder.object(coinObjectIds[0]);
        coinObjectIds.shift();

        if (coinObjectIds.length) {
            for (let i = 0; i < coinObjectIds.length; i += 500) {
                const batch = coinObjectIds.slice(i, i + 500);
                transactionBuilder.mergeCoins(primaryCoinObject, batch);
            }
        }

        if (totalBalance.eq(upgradePrice)) {
            return primaryCoinObject;
        }

        const [splitCoin] = transactionBuilder.splitCoins(primaryCoinObject, [transactionBuilder.pure(upgradePrice)]);
        return splitCoin;
    }
};

const calculateFinishingInfo = (data, state) => {
    if (!data)
        return {
            timeToClaim: 0,
            unClaimedAmount: 0,
            progress: 0
        };
    if (!state)
        return {
            timeToClaim: 0,
            unClaimedAmount: calculateBalance(data.initReward, 9),
            progress: 100
        };
    const boatLevel = data.boatLevel[state.boat],
        meshLevel = data.meshLevel[state.mesh],
        fishTypeLevel = data.fishTypeLevel[state.seafood],
        currentTime = new Date().getTime();
    let timeSinceLastClaim = new BigNumber(0),
        fishingTime = boatLevel.fishing_time * 60 * 60 * 1e3 / 1e4;
    if (new BigNumber(state.last_claim).plus(fishingTime).gt(currentTime)) {
        timeSinceLastClaim = new BigNumber(state.last_claim).plus(fishingTime).minus(currentTime);
    }
    let estimatedFishingAmount = new BigNumber(fishingTime).minus(timeSinceLastClaim)
        .div(fishingTime)
        .times(boatLevel.fishing_time)
        .div(1e4)
        .times(meshLevel.speed)
        .div(1e4)
        .times(fishTypeLevel.rate)
        .div(1e4);
    if (state.special_boost) {
        let specialBoost = data.specialBoost[state.special_boost];
        if (specialBoost.type == 0 && currentTime >= specialBoost.start_time && currentTime <= specialBoost.start_time + specialBoost.duration) {
            estimatedFishingAmount = estimatedFishingAmount.times(specialBoost.rate).div(1e4);
        }
        if (specialBoost.type == 1 && currentTime >= state.special_boost_start_time && currentTime <= state.special_boost_start_time + specialBoost.duration) {
            estimatedFishingAmount = estimatedFishingAmount.times(specialBoost.rate).div(1e4);
        }
    }
    return {
        timeToClaim: timeSinceLastClaim.toNumber(),
        unClaimedAmount: estimatedFishingAmount.toFixed(5),
        progress: new BigNumber(fishingTime).minus(timeSinceLastClaim).times(100).div(fishingTime)
    };
};

const makeClaimTx = (client, keypair, suiAddress) => new Promise(async (resolve, reject) => {

    try {
        const gasBudget = '10000000';

        const txb = new TransactionBlock();
        txb.moveCall({
            target: `${CLAIM_PACKAGE_ID}::game::claim`,
            arguments: [txb.object(CLAIM_OBJECT_ID), txb.object('0x6')]
        });
        txb.setGasBudget(gasBudget);
        txb.setSender(suiAddress);

        const {
            bytes,
            signature
        } = await txb.sign({
            client,
            signer: keypair
        });

        resolve({
            bytes,
            signature
        })
    } catch (error) {
        reject(error)
    }
});

const sendTransaction = (client, bytes, signature) => new Promise(async (resolve, reject) => {

    try {
        await client.dryRunTransactionBlock({
            transactionBlock: bytes
        });
        const result = await client.executeTransactionBlock({
            signature: signature,
            transactionBlock: bytes,
            requestType: 'WaitForLocalExecution',
            options: {
                showEffects: true
            }
        });
        resolve(result)
    } catch (error) {
        reject(error)
    }
});

const executeTx = async (e, t, n, s) => {
    var i, a;
    const { bytes: r, signature: o } = await e.sign({
        client: _client,
        onlyTransactionKind: n,
        signer: t
    });
    await _client.dryRunTransactionBlock({
        transactionBlock: r
    });
    if (!s) {
        a = (await _client.executeTransactionBlock({
            transactionBlock: r,
            signature: o,
            requestType: "WaitForLocalExecution",
            options: {
                showEffects: true
            }
        })).effects;
        return a == null ? undefined : a.status.status;
    }
};

(async () => {

    const mnemonicsData = fs.readFileSync('path/to/your/mnemonics.json', 'utf-8');
    const mnemonics = JSON.parse(mnemonicsData);

    const SUI_MNEMONIC = readlineSync.keyInSelect(mnemonics, 'Select your mnemonic / seed phrase: ');
    if (SUI_MNEMONIC === -1) {
        console.log(chalk.red('Please select a valid mnemonic.'));
        process.exit(0); 
    }

    const selectedMnemonic = mnemonics[SUI_MNEMONIC];

    const isUpgradeAnswer = readlineSync.question('activate auto upgrade ( y / n ) : ');
    if(!['y', 'n'].includes(isUpgradeAnswer)){
        console.log(chalk.red('Please input the correct answer.'))
        process.exit(0); 
    }

    let isUpgradeActive = false;
    let autoUpgradeStatus = 'off';
    if (isUpgradeAnswer === 'y') {
        isUpgradeActive = true;
        autoUpgradeStatus = 'on';
    }

    const isAutoSendAnswer = readlineSync.question('activate auto transfer ( y / n ) : ');
    if(!['y', 'n'].includes(isAutoSendAnswer)){
        console.log(chalk.red('Please input the correct answer.'))
        process.exit(0); 
    }

    let isAutoTransfer = false
    let amountToAutoTransfer = 0;
    let receipentAutoTransfer = '';
    let autoTransferStatus = 'off';
    if (isAutoSendAnswer === 'y') {
        isAutoTransfer = true;
        amountToAutoTransfer = readlineSync.question('transfer amount : ');
        receipentAutoTransfer = readlineSync.question('transfer address : ');
        autoTransferStatus = 'on';
    }

    console.log('')

    const keypair = Ed25519Keypair.deriveKeypair(selectedMnemonic);
    const suiAddress = keypair.getPublicKey().toSuiAddress();

    const twisters = new Twisters({
        clean: true,
    });

    twisters.add('state', `${chalk.green('starting')}`);

    const state = await _client.getObject({
        id: CLAIM_OBJECT_ID,
        options: {
            showContent: true
        }
    });

    const content = state.data.content.fields;
    const data = JSON.parse(content.data);
    const finishingInfo = calculateFinishingInfo(data, content.state.fields);

    let { unClaimedAmount, progress, timeToClaim } = finishingInfo;

    const interval = setInterval(() => {

        twisters.update('state', `${chalk.green('starting')}  |  claim in progress: ${chalk.green(progress.toFixed(2) + '%')}  |  unClaimedAmount: ${chalk.green(unClaimedAmount)}  |  timeToClaim: ${chalk.green((timeToClaim / 1000).toFixed(0))} sec`)

        if (progress >= 100) {

            twisters.update('state', `${chalk.green('starting')}  |  ${chalk.green('claiming reward')}`);

            clearInterval(interval);

            makeClaimTx(_client, keypair, suiAddress)
                .then(async ({ bytes, signature }) => {
                    try {
                        await sendTransaction(_client, bytes, signature);

                        twisters.update('state', `${chalk.green('starting')}  |  ${chalk.green('claim reward success')}`);

                        const state = await _client.getObject({
                            id: CLAIM_OBJECT_ID,
                            options: {
                                showContent: true
                            }
                        });

                        const content = state.data.content.fields;
                        const data = JSON.parse(content.data);
                        const finishingInfo = calculateFinishingInfo(data, content.state.fields);

                        let { unClaimedAmount, progress, timeToClaim } = finishingInfo;

                        let _amountToAutoTransfer = reverseCalculateBalance(amountToAutoTransfer, 9);

                        if (isAutoTransfer) {
                            const coin = await getCoinOfValue(_client, suiAddress, _amountToAutoTransfer, OCEAN_COIN_TYPE);

                            const txb = new TransactionBlock();

                            if (coin) {
                                txb.transferObjects([txb.object(coin)], txb.pure(receipentAutoTransfer));
                                txb.setGasBudget('100000000');

                                const result = await executeTx(_client, txb, keypair, true);

                                if (result) {
                                    twisters.update('state', `${chalk.green('starting')}  |  ${chalk.green('auto transfer success')}`);
                                } else {
                                    twisters.update('state', `${chalk.green('starting')}  |  ${chalk.green('auto transfer failed')}`);
                                }
                            }
                        }

                        console.log('\n\n');
                        console.log('=========================================================')
                        console.log(`Current Time: ${new Date().toLocaleString()}`);
                        console.log(`Sui Address: ${chalk.green(suiAddress)}`);
                        console.log(`Ocean Amount: ${chalk.green(unClaimedAmount)}`);
                        console.log(`Claim Status: ${chalk.green('Success')}`);
                        console.log(`Auto Upgrade: ${chalk.green(autoUpgradeStatus)}`);
                        console.log(`Auto Transfer: ${chalk.green(autoTransferStatus)}`);
                        console.log(`Next Claim: ${chalk.green((timeToClaim / 1000 / 60).toFixed(0))} minutes`);
                        console.log('=========================================================\n\n');

                        setTimeout(async () => {
                            clear();
                            await execute();
                        }, timeToClaim + 1000);

                    } catch (error) {
                        console.log(error.message);
                    }
                })
                .catch(error => {
                    console.log(error.message);
                });
        } else {
            timeToClaim -= 1000;
            progress += 1000 / finishingInfo.fishingTime * 100;
        }

    }, 1000);

})();
