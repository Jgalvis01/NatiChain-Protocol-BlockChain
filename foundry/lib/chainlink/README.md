# Chainlink Solidity subset

Unmodified transitive source files needed by `VRFConsumerBaseV2Plus`, from
`@chainlink/contracts` **1.5.0**, MIT license (SPDX in each file).

Package: https://www.npmjs.com/package/@chainlink/contracts/v/1.5.0

Upstream: https://github.com/smartcontractkit/chainlink-evm

Only eight required files are vendored so Foundry can compile without npm or a
network dependency. NatiChain uses the official coordinator authentication base;
the actual cryptographic proof is verified by the deployed Chainlink coordinator.
