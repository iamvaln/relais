// GÉNÉRÉ par `npm run chain:abi -w apps/api` depuis contracts/out — ne pas éditer.
// ABI du contrat RelaisDms (contracts/src/RelaisDms.sol), figée dans le code
// pour que l'API n'ait pas besoin de Foundry à l'exécution.

export const relaisDmsAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "operator_",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "acceptOperator",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancelTrigger",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "nextDue",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "ownerSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "checkin",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "nextDue",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "ownerSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "complete",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "deactivate",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "ownerSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "get",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct RelaisDms.Dms",
        "components": [
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum RelaisDms.Status"
          },
          {
            "name": "n",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "m",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "silenceSecs",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "checkinFreqSecs",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "nextCheckinDue",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "pausedUntil",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "triggeredAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "ed25519Pk",
            "type": "bytes32",
            "internalType": "bytes32"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "operator",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pause",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "until",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "ownerSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "pendingOperator",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "pointers",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "packCids",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      },
      {
        "name": "vaultCid",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "proposeOperator",
    "inputs": [
      {
        "name": "next",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "register",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "ed25519Pk",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "n",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "m",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "silenceSecs",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "checkinFreqSecs",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "nextDue",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "ownerSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "resume",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "nextDue",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "ownerSig",
        "type": "bytes",
        "internalType": "bytes"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "secondsUntilTriggerable",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "setPointers",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "packCids",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      },
      {
        "name": "vaultCid",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setShareHashes",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "siEncHashes",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "shareHashes",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bytes32[]",
        "internalType": "bytes32[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "trigger",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "triggerable",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "CheckedIn",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "nextCheckinDue",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "ownerSig",
        "type": "bytes",
        "indexed": false,
        "internalType": "bytes"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Completed",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Deactivated",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "ownerSig",
        "type": "bytes",
        "indexed": false,
        "internalType": "bytes"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OperatorAccepted",
    "inputs": [
      {
        "name": "next",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "OperatorProposed",
    "inputs": [
      {
        "name": "next",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Paused",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "pausedUntil",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "ownerSig",
        "type": "bytes",
        "indexed": false,
        "internalType": "bytes"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Pointers",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "packCids",
        "type": "bytes32[]",
        "indexed": false,
        "internalType": "bytes32[]"
      },
      {
        "name": "vaultCid",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Registered",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "ed25519Pk",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "n",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "m",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "silenceSecs",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "checkinFreqSecs",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "nextCheckinDue",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "ownerSig",
        "type": "bytes",
        "indexed": false,
        "internalType": "bytes"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Resumed",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "nextCheckinDue",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "ownerSig",
        "type": "bytes",
        "indexed": false,
        "internalType": "bytes"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ShareHashes",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "siEncHashes",
        "type": "bytes32[]",
        "indexed": false,
        "internalType": "bytes32[]"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "TriggerCancelled",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "nextCheckinDue",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "ownerSig",
        "type": "bytes",
        "indexed": false,
        "internalType": "bytes"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "Triggered",
    "inputs": [
      {
        "name": "subject",
        "type": "bytes32",
        "indexed": true,
        "internalType": "bytes32"
      },
      {
        "name": "at",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "by",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "BadDueDate",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadDuration",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadPauseDate",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadSignature",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadStatus",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BadThreshold",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotOperator",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotPendingOperator",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotTriggerable",
    "inputs": []
  },
  {
    "type": "error",
    "name": "SubjectMismatch",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  }
] as const
