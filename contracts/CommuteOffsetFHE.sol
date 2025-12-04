// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract CommuteOffsetFHE is SepoliaConfig {
    struct EncryptedCommuteData {
        uint256 id;
        euint32 encryptedDistance;
        euint32 encryptedTransportMode;
        euint32 encryptedEmployeeId;
        uint256 timestamp;
    }
    
    struct DecryptedCommuteData {
        uint256 distance;
        string transportMode;
        string employeeId;
        bool isProcessed;
    }

    uint256 public commuteDataCount;
    mapping(uint256 => EncryptedCommuteData) public encryptedCommutes;
    mapping(uint256 => DecryptedCommuteData) public decryptedCommutes;
    
    mapping(string => euint32) private encryptedModeStats;
    string[] private transportModeList;
    
    mapping(uint256 => uint256) private requestToCommuteId;
    
    event CommuteDataSubmitted(uint256 indexed id, uint256 timestamp);
    event OffsetCalculationRequested(uint256 indexed id);
    event CommuteDataProcessed(uint256 indexed id);
    
    modifier onlyEmployee(uint256 commuteId) {
        _;
    }
    
    function submitEncryptedCommuteData(
        euint32 encryptedDistance,
        euint32 encryptedTransportMode,
        euint32 encryptedEmployeeId
    ) public {
        commuteDataCount += 1;
        uint256 newId = commuteDataCount;
        
        encryptedCommutes[newId] = EncryptedCommuteData({
            id: newId,
            encryptedDistance: encryptedDistance,
            encryptedTransportMode: encryptedTransportMode,
            encryptedEmployeeId: encryptedEmployeeId,
            timestamp: block.timestamp
        });
        
        decryptedCommutes[newId] = DecryptedCommuteData({
            distance: 0,
            transportMode: "",
            employeeId: "",
            isProcessed: false
        });
        
        emit CommuteDataSubmitted(newId, block.timestamp);
    }
    
    function requestCarbonOffset(uint256 commuteId) public onlyEmployee(commuteId) {
        EncryptedCommuteData storage commute = encryptedCommutes[commuteId];
        require(!decryptedCommutes[commuteId].isProcessed, "Already processed");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(commute.encryptedDistance);
        ciphertexts[1] = FHE.toBytes32(commute.encryptedTransportMode);
        ciphertexts[2] = FHE.toBytes32(commute.encryptedEmployeeId);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.calculateFootprint.selector);
        requestToCommuteId[reqId] = commuteId;
        
        emit OffsetCalculationRequested(commuteId);
    }
    
    function calculateFootprint(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 commuteId = requestToCommuteId[requestId];
        require(commuteId != 0, "Invalid request");
        
        EncryptedCommuteData storage eCommute = encryptedCommutes[commuteId];
        DecryptedCommuteData storage dCommute = decryptedCommutes[commuteId];
        require(!dCommute.isProcessed, "Already processed");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (uint256 distance, string memory transportMode, string memory employeeId) = 
            abi.decode(cleartexts, (uint256, string, string));
        
        dCommute.distance = distance;
        dCommute.transportMode = transportMode;
        dCommute.employeeId = employeeId;
        dCommute.isProcessed = true;
        
        if (FHE.isInitialized(encryptedModeStats[dCommute.transportMode]) == false) {
            encryptedModeStats[dCommute.transportMode] = FHE.asEuint32(0);
            transportModeList.push(dCommute.transportMode);
        }
        encryptedModeStats[dCommute.transportMode] = FHE.add(
            encryptedModeStats[dCommute.transportMode], 
            FHE.asEuint32(1)
        );
        
        emit CommuteDataProcessed(commuteId);
    }
    
    function getDecryptedCommuteData(uint256 commuteId) public view returns (
        uint256 distance,
        string memory transportMode,
        string memory employeeId,
        bool isProcessed
    ) {
        DecryptedCommuteData storage c = decryptedCommutes[commuteId];
        return (c.distance, c.transportMode, c.employeeId, c.isProcessed);
    }
    
    function getEncryptedModeStats(string memory transportMode) public view returns (euint32) {
        return encryptedModeStats[transportMode];
    }
    
    function requestModeStatsDecryption(string memory transportMode) public {
        euint32 stats = encryptedModeStats[transportMode];
        require(FHE.isInitialized(stats), "Transport mode not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(stats);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptModeStats.selector);
        requestToCommuteId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(transportMode)));
    }
    
    function decryptModeStats(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 modeHash = requestToCommuteId[requestId];
        string memory transportMode = getTransportModeFromHash(modeHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 stats = abi.decode(cleartexts, (uint32));
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
    
    function getTransportModeFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < transportModeList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(transportModeList[i]))) == hash) {
                return transportModeList[i];
            }
        }
        revert("Transport mode not found");
    }
    
    function calculateTotalFootprint() public view returns (uint256 totalCarbon) {
        for (uint256 i = 1; i <= commuteDataCount; i++) {
            if (decryptedCommutes[i].isProcessed) {
                totalCarbon += calculateCarbonEmission(
                    decryptedCommutes[i].distance,
                    decryptedCommutes[i].transportMode
                );
            }
        }
        return totalCarbon;
    }
    
    function calculateCarbonEmission(
        uint256 distance,
        string memory transportMode
    ) private pure returns (uint256 carbon) {
        // Simplified emission factors (kg CO2 per km)
        if (keccak256(abi.encodePacked(transportMode)) == keccak256(abi.encodePacked("car"))) {
            return distance * 120 / 1000; // 120g/km
        } else if (keccak256(abi.encodePacked(transportMode)) == keccak256(abi.encodePacked("bus"))) {
            return distance * 68 / 1000; // 68g/km
        } else if (keccak256(abi.encodePacked(transportMode)) == keccak256(abi.encodePacked("train"))) {
            return distance * 14 / 1000; // 14g/km
        } else {
            return distance * 50 / 1000; // Default 50g/km
        }
    }
    
    function purchaseCarbonCredits(
        uint256 carbonAmount,
        string memory creditType
    ) public pure returns (uint256 creditsNeeded) {
        // Simplified conversion (1 credit = 1 ton CO2)
        return carbonAmount / 1000; // Convert kg to tons
    }
}