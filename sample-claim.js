import { getFullnodeUrl, SuiClient } from '@mysten/sui.js/client';
import { Ed25519Keypair } from '@mysten/sui.js/keypairs/ed25519';
import { TransactionBlock } from '@mysten/sui.js/transactions';

const SUI_MNEMONIC = ''; // mnemonic mu disini
const CLAIM_PACKAGE_ID = '0x1efaf509c9b7e986ee724596f526a22b474b15c376136772c00b8452f204d2d1';
const CLAIM_OBJECT_ID = '0x4846a1f1030deffd9dea59016402d832588cf7e0c27b9e4c1a63d2b5e152873a';
const OCEAN_PACKAGE_ID = '0xa8816d3a6e3136e86bc2873b1f94a15cadc8af2703c075f2d546c2ae367f4df9';

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


(async () => {
    const secret_key_mnemonics = SUI_MNEMONIC;
    const keypair = Ed25519Keypair.deriveKeypair(secret_key_mnemonics);
    const suiAddress = keypair.getPublicKey().toSuiAddress();

    const client = new SuiClient({
        url: getFullnodeUrl('mainnet'),
    });



    // claim
    const {
        bytes,
        signature
    } = await makeClaimTx(client, keypair, suiAddress);
    const txResult = await sendTransaction(client, bytes, signature);
    console.log(txResult)






})();
