const { ethers, network } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log(`\nDéploiement sur ${network.name}`);
  console.log(`Deployer : ${deployer.address}`);
  console.log(`Balance  : ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

  // Déploiement
  const Factory = await ethers.getContractFactory("RelaisDeadManSwitch");
  const dms = await Factory.deploy();
  await dms.waitForDeployment();

  const address = await dms.getAddress();
  const receipt = await dms.deploymentTransaction().wait();

  console.log("✅ RelaisDeadManSwitch déployé !");
  console.log(`   Adresse : ${address}`);
  console.log(`   Tx hash : ${receipt.hash}`);
  console.log(`   Bloc    : ${receipt.blockNumber}`);
  console.log(`   Gas     : ${receipt.gasUsed.toString()}`);

  // Vérification des constantes
  const pauseMax  = await dms.PAUSE_MAX_SECS();
  const maxConts  = await dms.MAX_CONTACTS();
  console.log(`\n   PAUSE_MAX_SECS : ${pauseMax} (${Number(pauseMax) / 86400} jours)`);
  console.log(`   MAX_CONTACTS   : ${maxConts}`);

  // Ajouter dans le backend
  console.log(`\n📋 À ajouter dans les variables d'environnement backend :`);
  console.log(`   RELAIS_CONTRACT_ADDRESS=${address}`);

  if (network.name !== "hardhat" && network.name !== "localhost") {
    console.log(`\n🔍 Vérification Arbiscan dans 30s...`);
    await new Promise(r => setTimeout(r, 30_000));
    try {
      await run("verify:verify", { address, constructorArguments: [] });
      console.log("✅ Contrat vérifié sur Arbiscan");
    } catch (e) {
      console.log(`⚠️  Vérification manuelle : npx hardhat verify --network ${network.name} ${address}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
