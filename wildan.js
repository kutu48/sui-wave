import { getFullnodeUrl, SuiClient } from "@mysten/sui.js/client";
import { Ed25519Keypair } from "@mysten/sui.js/keypairs/ed25519";
import { TransactionBlock } from "@mysten/sui.js/transactions";
import BigNumber from "bignumber.js";
import fs from "fs";
import { Twisters } from "twisters";
import chalk from "chalk";
import delay from "delay";
import { getCoinOfValue } from "@polymedia/suits";

const CLAIM_PACKAGE_ID =
  "0x1efaf509c9b7e986ee724596f526a22b474b15c376136772c00b8452f204d2d1";
const CLAIM_OBJECT_ID =
  "0x4846a1f1030deffd9dea59016402d832588cf7e0c27b9e4c1a63d2b5e152873a";
const OCEAN_PACKAGE_ID =
  "0xa8816d3a6e3136e86bc2873b1f94a15cadc8af2703c075f2d546c2ae367f4df9";
const OCEAN_COIN_TYPE = `${OCEAN_PACKAGE_ID}::ocean::OCEAN`;

function calculateBalance(totalBalance, divider) {
  return Number(totalBalance) / Math.pow(10, divider);
}

const calculateFinishingInfo = (data, state) => {
  if (!data)
    return {
      timeToClaim: 0,
      unClaimedAmount: 0,
      progress: 0,
    };
  if (!state)
    return {
      timeToClaim: 0,
      unClaimedAmount: calculateBalance(data.initReward, 9),
      progress: 100,
    };
  const boatLevel = data.boatLevel[state.boat],
    meshLevel = data.meshLevel[state.mesh],
    fishTypeLevel = data.fishTypeLevel[state.seafood],
    currentTime = new Date().getTime();
  let timeSinceLastClaim = new BigNumber(0),
    fishingTime = (boatLevel.fishing_time * 60 * 60 * 1e3) / 1e4;
  if (new BigNumber(state.last_claim).plus(fishingTime).gt(currentTime)) {
    timeSinceLastClaim = new BigNumber(state.last_claim)
      .plus(fishingTime)
      .minus(currentTime);
  }
  let estimatedFishingAmount = new BigNumber(fishingTime)
    .minus(timeSinceLastClaim)
    .div(fishingTime)
    .times(boatLevel.fishing_time)
    .div(1e4)
    .times(meshLevel.speed)
    .div(1e4)
    .times(fishTypeLevel.rate)
    .div(1e4);
  if (state.special_boost) {
    let specialBoost = data.specialBoost[state.special_boost];
    if (
      specialBoost.type == 0 &&
      currentTime >= specialBoost.start_time &&
      currentTime <= specialBoost.start_time + specialBoost.duration
    ) {
      estimatedFishingAmount = estimatedFishingAmount
        .times(specialBoost.rate)
        .div(1e4);
    }
    if (
      specialBoost.type == 1 &&
      currentTime >= state.special_boost_start_time &&
      currentTime <= state.special_boost_start_time + specialBoost.duration
    ) {
      estimatedFishingAmount = estimatedFishingAmount
        .times(specialBoost.rate)
        .div(1e4);
    }
  }
  return {
    timeToClaim: timeSinceLastClaim.toNumber(),
    unClaimedAmount: estimatedFishingAmount.toFixed(5),
    progress: new BigNumber(fishingTime)
      .minus(timeSinceLastClaim)
      .times(100)
      .div(fishingTime),
  };
};

const makeClaimTx = (client, keypair, suiAddress) =>
  new Promise(async (resolve, reject) => {
    try {
      const gasBudget = "10000000";

      const txb = new TransactionBlock();
      txb.moveCall({
        target: `${CLAIM_PACKAGE_ID}::game::claim`,
        arguments: [txb.object(CLAIM_OBJECT_ID), txb.object("0x6")],
      });
      txb.setGasBudget(gasBudget);
      txb.setSender(suiAddress);

      const { bytes, signature } = await txb.sign({
        client,
        signer: keypair,
      });

      resolve({
        bytes,
        signature,
      });
    } catch (error) {
      reject(error);
    }
  });

const sendTransaction = (client, bytes, signature) =>
  new Promise(async (resolve, reject) => {
    try {
      await client.dryRunTransactionBlock({
        transactionBlock: bytes,
      });
      const result = await client.executeTransactionBlock({
        signature: signature,
        transactionBlock: bytes,
        requestType: "WaitForLocalExecution",
        options: {
          showEffects: true,
        },
      });
      resolve(result);
    } catch (error) {
      reject(error);
    }
  });

const readFileToJSON = (path) => {
  return JSON.parse(fs.readFileSync(path, "utf8"));
};

const client = new SuiClient({
  url: getFullnodeUrl("mainnet"),
});

(async () => {
  const loadConfig = readFileToJSON("./config.json");
  const mnemonicList = readFileToJSON("./mnemonic.json");
  const gameInfoData = fs.readFileSync("./gameInfo.json", "utf-8");
  const twisters = new Twisters();

  while (true) {
    for (let i = 0; i < mnemonicList.length; i++) {
      const mnemonic = mnemonicList[i];
      const keypair = Ed25519Keypair.deriveKeypair(mnemonic);
      const suiAddress = keypair.getPublicKey().toSuiAddress();

      const suiBalance = await client.getBalance({
        owner: suiAddress,
        coinType: "0x2::sui::SUI",
      });
      let suiBalanceFormatted = await calculateBalance(
        suiBalance.totalBalance,
        9
      );
      const oceanBalance = await client.getBalance({
        owner: suiAddress,
        coinType: OCEAN_COIN_TYPE,
      });
      let oceanBalanceFormatted = await calculateBalance(
        oceanBalance.totalBalance,
        9
      );

      const userClaimInfo = await client.getDynamicFieldObject({
        parentId: CLAIM_OBJECT_ID,
        name: {
          type: "address",
          value: suiAddress,
        },
      });
      const dataUserClaimInfo = userClaimInfo.data.content.fields;
      const resultWhenClaim = await calculateFinishingInfo(
        JSON.parse(gameInfoData),
        dataUserClaimInfo
      );
      twisters.put(mnemonic, {
        text: `[Address: ${suiAddress}][S : ${suiBalanceFormatted} O : ${oceanBalanceFormatted}] Unclaimed Amount: ${
          resultWhenClaim.unClaimedAmount
        } ${resultWhenClaim.progress.toFixed(2)}% - ${chalk.cyan(
          "WAITING TO CLAIM"
        )}`,
      });
      if (resultWhenClaim.progress >= 100) {
        twisters.put(mnemonic, {
          text: `[Address: ${suiAddress}][S : ${suiBalanceFormatted} O : ${oceanBalanceFormatted}] Unclaimed Amount: ${
            resultWhenClaim.unClaimedAmount
          } ${resultWhenClaim.progress.toFixed(2)}% - ${chalk.yellow(
            "READY TO CLAIM"
          )}`,
        });
        fs.appendFileSync(
          "logs.txt",
          `[${new Date()}] [Address: ${suiAddress}][S : ${suiBalanceFormatted} O : ${oceanBalanceFormatted}] Unclaimed Amount: ${
            resultWhenClaim.unClaimedAmount
          } ${resultWhenClaim.progress.toFixed(2)}% - READY TO CLAIM\n`
        );
        try {
          const { bytes, signature } = await makeClaimTx(
            client,
            keypair,
            suiAddress
          );
          const txResult = await sendTransaction(client, bytes, signature);
          if (txResult.effects.status.status === "success") {
            twisters.put(mnemonic, {
              text: `[Address: ${suiAddress}][S : ${suiBalanceFormatted} O : ${oceanBalanceFormatted}] Unclaimed Amount: ${
                resultWhenClaim.unClaimedAmount
              } ${resultWhenClaim.progress.toFixed(2)}% - ${chalk.green(
                "SUCCESS TO CLAIM"
              )}`,
            });
            fs.appendFileSync(
              "logs.txt",
              `[${new Date()}] [Address: ${suiAddress}][S : ${suiBalanceFormatted} O : ${oceanBalanceFormatted}] Unclaimed Amount: ${
                resultWhenClaim.unClaimedAmount
              } ${resultWhenClaim.progress.toFixed(2)}% - SUCCESS TO CLAIM\n`
            );

            if (
              loadConfig.autoTransferMaxOcean === true ||
              loadConfig.autoTransferMaxOcean === "true"
            ) {
              if (loadConfig.destinationAddress != "") {
                twisters.put(mnemonic, {
                  text: `[Address: ${suiAddress}][S : ${suiBalanceFormatted} O : ${oceanBalanceFormatted}] Unclaimed Amount: ${
                    resultWhenClaim.unClaimedAmount
                  } ${resultWhenClaim.progress.toFixed(2)}% - ${chalk.blue(
                    "TRANSFERING OCEAN TO DESTINATION ADDRESS"
                  )}`,
                });
                fs.appendFileSync(
                  "logs.txt",
                  `[${new Date()}] [Address: ${suiAddress}][S : ${suiBalanceFormatted} O : ${oceanBalanceFormatted}] Unclaimed Amount: ${
                    resultWhenClaim.unClaimedAmount
                  } ${resultWhenClaim.progress.toFixed(
                    2
                  )}% - TRANSFERING OCEAN TO DESTINATION ADDRESS\n`
                );

                const destinationAddress = loadConfig.destinationAddress;

                const oceanBalance = await client.getBalance({
                  owner: suiAddress,
                  coinType: OCEAN_COIN_TYPE,
                });

                const amountToSendResult = oceanBalance.totalBalance;
                const txbTfOcean = new TransactionBlock();
                const [coin] = await getCoinOfValue(
                  client,
                  txbTfOcean,
                  suiAddress,
                  OCEAN_COIN_TYPE,
                  amountToSendResult
                );
                txbTfOcean.transferObjects(
                  [coin],
                  txbTfOcean.pure(destinationAddress)
                );
                const gasBudget = "10000000";
                txbTfOcean.setGasBudget(gasBudget);
                txbTfOcean.setSender(suiAddress);

                const { bytes, signature } = await txbTfOcean.sign({
                  client,
                  signer: keypair,
                });
                try {
                  const txTfResult = await sendTransaction(
                    client,
                    bytes,
                    signature
                  );
                  if (txTfResult.effects.status.status === "success") {
                    twisters.put(mnemonic, {
                      text: `[Address: ${suiAddress}][S : ${suiBalanceFormatted} O : ${oceanBalanceFormatted}] Unclaimed Amount: ${
                        resultWhenClaim.unClaimedAmount
                      } ${resultWhenClaim.progress.toFixed(2)}% - ${chalk.green(
                        "SUCCESS TO TRANSFER OCEAN"
                      )}`,
                    });
                    fs.appendFileSync(
                      "logs.txt",
                      `[${new Date()}] [Address: ${suiAddress}][S : ${suiBalanceFormatted} O : ${oceanBalanceFormatted}] Unclaimed Amount: ${
                        resultWhenClaim.unClaimedAmount
                      } ${resultWhenClaim.progress.toFixed(
                        2
                      )}% - SUCCESS TO TRANSFER OCEAN\n`
                    );
                  } else {
                    twisters.put(mnemonic, {
                      text: `[Address: ${suiAddress}][S : ${suiBalanceFormatted} O : ${oceanBalanceFormatted}] Unclaimed Amount: ${
                        resultWhenClaim.unClaimedAmount
                      } ${resultWhenClaim.progress.toFixed(2)}% - ${chalk.red(
                        "FAILED TO TRANSFER OCEAN"
                      )}`,
                    });
                    fs.appendFileSync(
                      "logs.txt",
                      `[${new Date()}] [Address: ${suiAddress}][S : ${suiBalanceFormatted} O : ${oceanBalanceFormatted}] Unclaimed Amount: ${
                        resultWhenClaim.unClaimedAmount
                      } ${resultWhenClaim.progress.toFixed(
                        2
                      )}% - FAILED TO TRANSFER OCEAN\n`
                    );
                  }
                } catch (error) {
                  twisters.put(mnemonic, {
                    text: `[Address: ${suiAddress}][S : ${suiBalanceFormatted} O : ${oceanBalanceFormatted}] Unclaimed Amount: ${
                      resultWhenClaim.unClaimedAmount
                    } ${resultWhenClaim.progress.toFixed(2)}% - ${chalk.red(
                      "FAILED TO TRANSFER OCEAN - ERROR THROW"
                    )}`,
                  });
                  fs.appendFileSync(
                    "logs.txt",
                    `[${new Date()}] [Address: ${suiAddress}][S : ${suiBalanceFormatted} O : ${oceanBalanceFormatted}] Unclaimed Amount: ${
                      resultWhenClaim.unClaimedAmount
                    } ${resultWhenClaim.progress.toFixed(
                      2
                    )}% - FAILED TO TRANSFER OCEAN - ERROR THROW ${
                      error.message
                    }\n`
                  );
                }
              }
            }
          } else {
            twisters.put(mnemonic, {
              text: `[Address: ${suiAddress}][S : ${suiBalanceFormatted} O : ${oceanBalanceFormatted}] Unclaimed Amount: ${
                resultWhenClaim.unClaimedAmount
              } ${resultWhenClaim.progress.toFixed(2)}% - ${chalk.red(
                "FAILED TO CLAIM"
              )}`,
            });
            fs.appendFileSync(
              "logs.txt",
              `[${new Date()}] [Address: ${suiAddress}][S : ${suiBalanceFormatted} O : ${oceanBalanceFormatted}] Unclaimed Amount: ${
                resultWhenClaim.unClaimedAmount
              } ${resultWhenClaim.progress.toFixed(2)}% - FAILED TO CLAIM\n`
            );
          }

          await delay(1000);
        } catch (error) {
          twisters.put(mnemonic, {
            text: `[Address: ${suiAddress}][S : ${suiBalanceFormatted} O : ${oceanBalanceFormatted}] Unclaimed Amount: ${
              resultWhenClaim.unClaimedAmount
            } ${resultWhenClaim.progress.toFixed(2)}% - ${chalk.red(
              "FAILED TO CLAIM - ERROR THROW"
            )}`,
          });
          fs.appendFileSync(
            "logs.txt",
            `[${new Date()}] [Address: ${suiAddress}][S : ${suiBalanceFormatted} O : ${oceanBalanceFormatted}] Unclaimed Amount: ${
              resultWhenClaim.unClaimedAmount
            } ${resultWhenClaim.progress.toFixed(
              2
            )}% - FAILED TO CLAIM - ERROR THROW ${error.message}\n`
          );
        }
      }
    }
    await delay(1000);
  }
})();
