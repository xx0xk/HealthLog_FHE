pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract HealthLog_FHE is ZamaEthereumConfig {
    
    struct HealthEntry {
        string symptom;                    
        euint32 encryptedSeverity;        
        uint256 publicTimestamp;          
        uint256 publicDuration;          
        string medication;            
        address patient;               
        uint256 logTime;             
        uint32 decryptedSeverity; 
        bool isAnalyzed; 
    }
    

    mapping(string => HealthEntry) public healthEntries;
    
    string[] public entryIds;
    
    event HealthEntryCreated(string indexed entryId, address indexed patient);
    event AnalysisCompleted(string indexed entryId, uint32 decryptedSeverity);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function createHealthEntry(
        string calldata entryId,
        string calldata symptom,
        externalEuint32 encryptedSeverity,
        bytes calldata inputProof,
        uint256 publicTimestamp,
        uint256 publicDuration,
        string calldata medication
    ) external {
        require(bytes(healthEntries[entryId].symptom).length == 0, "Health entry already exists");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedSeverity, inputProof)), "Invalid encrypted input");
        
        healthEntries[entryId] = HealthEntry({
            symptom: symptom,
            encryptedSeverity: FHE.fromExternal(encryptedSeverity, inputProof),
            publicTimestamp: publicTimestamp,
            publicDuration: publicDuration,
            medication: medication,
            patient: msg.sender,
            logTime: block.timestamp,
            decryptedSeverity: 0,
            isAnalyzed: false
        });
        
        FHE.allowThis(healthEntries[entryId].encryptedSeverity);
        
        FHE.makePubliclyDecryptable(healthEntries[entryId].encryptedSeverity);
        
        entryIds.push(entryId);
        
        emit HealthEntryCreated(entryId, msg.sender);
    }
    
    function completeAnalysis(
        string calldata entryId, 
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(healthEntries[entryId].symptom).length > 0, "Health entry does not exist");
        require(!healthEntries[entryId].isAnalyzed, "Data already analyzed");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(healthEntries[entryId].encryptedSeverity);
        
        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        
        healthEntries[entryId].decryptedSeverity = decodedValue;
        healthEntries[entryId].isAnalyzed = true;
        
        emit AnalysisCompleted(entryId, decodedValue);
    }
    
    function getEncryptedSeverity(string calldata entryId) external view returns (euint32) {
        require(bytes(healthEntries[entryId].symptom).length > 0, "Health entry does not exist");
        return healthEntries[entryId].encryptedSeverity;
    }
    
    function getHealthEntry(string calldata entryId) external view returns (
        string memory symptom,
        uint256 publicTimestamp,
        uint256 publicDuration,
        string memory medication,
        address patient,
        uint256 logTime,
        bool isAnalyzed,
        uint32 decryptedSeverity
    ) {
        require(bytes(healthEntries[entryId].symptom).length > 0, "Health entry does not exist");
        HealthEntry storage entry = healthEntries[entryId];
        
        return (
            entry.symptom,
            entry.publicTimestamp,
            entry.publicDuration,
            entry.medication,
            entry.patient,
            entry.logTime,
            entry.isAnalyzed,
            entry.decryptedSeverity
        );
    }
    
    function getAllEntryIds() external view returns (string[] memory) {
        return entryIds;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}


