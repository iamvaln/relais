require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },

  networks: {
    // Réseau local pour les tests
    hardhat: {
      chainId: 31337,
    },

    // Arbitrum Sepolia (testnet)
    arbitrumSepolia: {
      url: process.env.ARBITRUM_SEPOLIA_RPC ?? "https://sepolia-rollup.arbitrum.io/rpc",
      chainId: 421614,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
    },

    // Arbitrum One (production)
    arbitrumOne: {
      url: process.env.ARBITRUM_RPC ?? "https://arb1.arbitrum.io/rpc",
      chainId: 42161,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
    },
  },

  // Vérification Arbiscan
  etherscan: {
    apiKey: {
      arbitrumSepolia: process.env.ARBISCAN_API_KEY ?? "",
      arbitrumOne:     process.env.ARBISCAN_API_KEY ?? "",
    },
    customChains: [
      {
        network:  "arbitrumSepolia",
        chainId:  421614,
        urls: {
          apiURL:     "https://api-sepolia.arbiscan.io/api",
          browserURL: "https://sepolia.arbiscan.io",
        },
      },
    ],
  },
};
