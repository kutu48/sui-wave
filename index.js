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
    if (!data || !data.content || !data.content.fields)
        return {
            timeToClaim: 0,
            unClaimedAmount: 0,
            progress: 0
        };
    if (!state || !state.content || !state.content.fields)
        return {
            timeToClaim: 0,
            unClaimedAmount: calculateBalance(data.content.fields.initReward, 9),
            progress: 100
        };

    const boatLevel = data.content.fields.boatLevel[state.content.fields.boat];
    const meshLevel = data.content.fields.meshLevel[state.content.fields.mesh];
    const fishTypeLevel = data.content.fields.fishTypeLevel[state.content.fields.seafood];
    const currentTime = new Date().getTime();

    let timeSinceLastClaim = new BigNumber(0);
    const fishingTime = boatLevel.fishing_time * 60 * 60 * 1e3 / 1e4;

    if (new BigNumber(state.content.fields.last_claim).plus(fishingTime).gt(currentTime)) {
        timeSinceLastClaim = new BigNumber(state.content.fields.last_claim).plus(fishingTime).minus(currentTime);
    }

    let estimatedFishingAmount = new BigNumber(fishingTime).minus(timeSinceLastClaim)
        .div(fishingTime)
        .times(boatLevel.fishing_time)
        .div(1e4)
        .times(meshLevel.speed)
        .div(1e4)
        .times(fishTypeLevel.rate)
        .div(1e4);

    if (state.content.fields.special_boost) {
        let specialBoost = data.content.fields.specialBoost[state.content.fields.special_boost];
        if (specialBoost.type == 0 && currentTime >= specialBoost.start_time && currentTime <= specialBoost.start_time + specialBoost.duration) {
            estimatedFishingAmount = estimatedFishingAmount.times(specialBoost.rate).div(1e4);
        }
        if (specialBoost.type == 1 && currentTime >= state.content.fields.special_boost_start_time && currentTime <= state.content.fields.special_boost_start_time + specialBoost.duration) {
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

        const txb = new TransactionBlock(); // TransactionBlock is created
        txb.moveCall({
            target: `${CLAIM_PACKAGE_ID}::game::claim`,
            arguments: [txb.object(CLAIM_OBJECT_ID), txb.object('0x6')]
        });
        txb.setGasBudget(gasBudget);
        txb.setSender(suiAddress); // Sender is set
        // Code to sign and resolve the promise...
    } catch (error) {
        reject(error);
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

// e client, t keypair, n value boolean
const executeTx = async (e, t, n, s) => {
    var i, a;
    const { bytes: r, signature: o } = await e.sign({
        client: _client,
        onlyTransactionKind: n,
        signer: t
    });
    // Set the sender address in the transaction block
    r.setSender(t.getPublicKey().toSuiAddress());
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
    const SUI_MNEMONIC = readlineSync.question('Input your mnemonic / seed pharse : ');
    if (!SUI_MNEMONIC) {
        console.log(chalk.red('Please input the correct answer.'));
        process.exit(0);
    }

    // Input aktivasi auto upgrade
    const isUpgradeAnswer = readlineSync.question('activate auto upgrade ( y / n ) : ');
    if (!['y', 'n'].includes(isUpgradeAnswer)) {
        console.log(chalk.red('Please input the correct answer.'));
        process.exit(0);
    }

    let isUpgradeActive = false;
    let autoUpgradeStatus = 'off';
    if (isUpgradeAnswer === 'y') {
        isUpgradeActive = true;
        autoUpgradeStatus = 'on';
    }

    // Input aktivasi auto transfer
    const isAutoSendAnswer = readlineSync.question('activate auto transfer ( y / n ) : ');
    if (!['y', 'n'].includes(isAutoSendAnswer)) {
        console.log(chalk.red('Please input the correct answer.'));
        process.exit(0);
    }

    let isAutoTransfer = false;
    let amountToAutoTransfer = 0;
    let receipentAutoTransfer = '';
    let autoTransferStatus = 'off';
    if (isAutoSendAnswer === 'y') {
        isAutoTransfer = true;
        amountToAutoTransfer = readlineSync.question('input nominal ocean to auto transfer : ');
        if (isNaN(parseInt(amountToAutoTransfer))) {
            console.log(chalk.red('Please input the correct answer.'));
            process.exit(0);
        }

        amountToAutoTransfer = parseInt(amountToAutoTransfer);

        receipentAutoTransfer = readlineSync.question('input receipent address : ');
        if (!receipentAutoTransfer) {
            console.log(chalk.red('Please input the correct answer.'));
            process.exit(0);
        }

        autoTransferStatus = 'on';
    }

    await clear();

    const twisters = new Twisters();

    const gameInfoData = fs.readFileSync('./gameInfo.json', 'utf-8');
    const gasBudget = '10000000';

    const secret_key_mnemonics = SUI_MNEMONIC;
    const keypair = Ed25519Keypair.deriveKeypair(secret_key_mnemonics);
    const suiAddress = keypair.getPublicKey().toSuiAddress();

    const client = new SuiClient({
        url: getFullnodeUrl('mainnet'),
    });

    // Dapatkan saldo ocean
    const oceanBalanceResult = await client.getBalance({
        owner: suiAddress,
        coinType: `${OCEAN_PACKAGE_ID}::ocean::OCEAN`
    });

    let realOceanBalance = await calculateBalance(oceanBalanceResult.totalBalance, 9);

    // Aktivasi auto upgrade
    if (isUpgradeActive) {
        // Dapatkan info klaim pengguna
        const userClaimInfo = await client.getDynamicFieldObject({
            parentId: CLAIM_OBJECT_ID,
            name: {
                type: 'address',
                value: suiAddress
            }
        });

        const dataUserClaimInfo = userClaimInfo.data.content.fields;
        const resultWhenClaim = await calculateFinishingInfo(JSON.parse(gameInfoData), dataUserClaimInfo);

        // Coba upgrade di percobaan pertama
        let fieldToUpdate = '';
        let levelType = '';
        let upgradeTo = 0;
        if (dataUserClaimInfo.mesh == dataUserClaimInfo.boat) {
            fieldToUpdate = 'upgrade_mesh';
            levelType = 'meshLevel';
            upgradeTo = dataUserClaimInfo.mesh;
        } else if (dataUserClaimInfo.mesh > dataUserClaimInfo.boat) {
            fieldToUpdate = 'upgrade_boat';
            levelType = 'boatLevel';
            upgradeTo = dataUserClaimInfo.boat;
        } else if (dataUserClaimInfo.boat > dataUserClaimInfo.mesh) {
            fieldToUpdate = 'upgrade_mesh';
            levelType = 'meshLevel';
            upgradeTo = dataUserClaimInfo.mesh;
        }

        twisters.put(suiAddress, {
            text: `
Sui Address : ${suiAddress}
Current Ocean Balance : ${realOceanBalance}
Last Claim : ${new Date(parseInt(dataUserClaimInfo.last_claim))}
Unclaimed Ocean : ${resultWhenClaim.unClaimedAmount}
Mesh Level : ${dataUserClaimInfo.mesh}
Boat Level : ${dataUserClaimInfo.boat}
Progress :  ${resultWhenClaim.progress}
Config : ( Auto Transfer : ${autoTransferStatus}, Auto Upgrade : ${autoUpgradeStatus} )
Status : ${chalk.yellow(`Trying to upgrade ${levelType} in first run.`)}
        `,
        });

        await delay(5000);

        const upgradeTxb = new TransactionBlock();
        if (fieldToUpdate && levelType) {
            const infoUpgradeData = JSON.parse(gameInfoData)[levelType][upgradeTo];
            const canUpgradeResult = await checkCanUpgrade(suiAddress, `${OCEAN_PACKAGE_ID}::ocean::OCEAN`, infoUpgradeData.price_upgrade, upgradeTxb);
            if (!canUpgradeResult) {
                twisters.put(suiAddress, {
                    text: `
Sui Address : ${suiAddress}
Current Ocean Balance : ${realOceanBalance}
Last Claim : ${new Date(parseInt(dataUserClaimInfo.last_claim))}
Unclaimed Ocean : ${resultWhenClaim.unClaimedAmount}
Mesh Level : ${dataUserClaimInfo.mesh}
Boat Level : ${dataUserClaimInfo.boat}
Progress :  ${resultWhenClaim.progress}
Config : ( Auto Transfer : ${autoTransferStatus}, Auto Upgrade : ${autoUpgradeStatus} )
Status : ${chalk.red(`Upgrade ${levelType} failed, Insufficient amount to upgrade!`)}
                    `,
                });
            } else {
                upgradeTxb.moveCall({
                    target: `${CLAIM_PACKAGE_ID}::game::${fieldToUpdate}`,
                    arguments: [upgradeTxb.object(CLAIM_OBJECT_ID), canUpgradeResult]
                });
                upgradeTxb.setGasBudget(gasBudget);
                upgradeTxb.setSender(suiAddress);

                const txResult = await executeTx(upgradeTxb, keypair, false)
                if (txResult === 'success') {
                    twisters.put(suiAddress, {
                        text: `
Sui Address : ${suiAddress}
Current Ocean Balance : ${realOceanBalance}
Last Claim : ${new Date(parseInt(dataUserClaimInfo.last_claim))}
Unclaimed Ocean : ${resultWhenClaim.unClaimedAmount}
Mesh Level : ${dataUserClaimInfo.mesh}
Boat Level : ${dataUserClaimInfo.boat}
Progress :  ${resultWhenClaim.progress}
Config : ( Auto Transfer : ${autoTransferStatus}, Auto Upgrade : ${autoUpgradeStatus} )
Status : ${chalk.green(`Upgrade ${levelType} Success.`)}
                        `,
                    });
                } else {
                    twisters.put(suiAddress, {
                        text: `
Sui Address : ${suiAddress}
Current Ocean Balance : ${realOceanBalance}
Last Claim : ${new Date(parseInt(dataUserClaimInfo.last_claim))}
Unclaimed Ocean : ${resultWhenClaim.unClaimedAmount}
Mesh Level : ${dataUserClaimInfo.mesh}
Boat Level : ${dataUserClaimInfo.boat}
Progress :  ${resultWhenClaim.progress}
Config : ( Auto Transfer : ${autoTransferStatus}, Auto Upgrade : ${autoUpgradeStatus} )
Status : ${chalk.red(`Upgrade ${levelType} failed. Reason: ${txResult}`)}
                        `,
                    });
                }
            }
        }
    }

    // Aktivasi auto transfer
    if (isAutoTransfer) {
        if (realOceanBalance >= amountToAutoTransfer) {
            const autoTxb = new TransactionBlock();
            autoTxb.moveCall({
                target: `${CLAIM_PACKAGE_ID}::game::auto_transfer`,
                arguments: [autoTxb.object(CLAIM_OBJECT_ID), autoTxb.string(receipentAutoTransfer), autoTxb.u64(amountToAutoTransfer)]
            });
            autoTxb.setGasBudget(gasBudget);
            autoTxb.setSender(suiAddress);

            const txResult = await executeTx(autoTxb, keypair, false)
            if (txResult === 'success') {
                twisters.put(suiAddress, {
                    text: `
Sui Address : ${suiAddress}
Current Ocean Balance : ${realOceanBalance}
Config : ( Auto Transfer : ${autoTransferStatus}, Auto Upgrade : ${autoUpgradeStatus} )
Status : ${chalk.green(`Auto Transfer Success.`)}
                    `,
                });
            } else {
                twisters.put(suiAddress, {
                    text: `
Sui Address : ${suiAddress}
Current Ocean Balance : ${realOceanBalance}
Config : ( Auto Transfer : ${autoTransferStatus}, Auto Upgrade : ${autoUpgradeStatus} )
Status : ${chalk.red(`Auto Transfer failed. Reason: ${txResult}`)}
                    `,
                });
            }
        } else {
            twisters.put(suiAddress, {
                text: `
Sui Address : ${suiAddress}
Current Ocean Balance : ${realOceanBalance}
Config : ( Auto Transfer : ${autoTransferStatus}, Auto Upgrade : ${autoUpgradeStatus} )
Status : ${chalk.red('Insufficient balance for auto transfer.')}
                `,
            });
        }
    }
})();
