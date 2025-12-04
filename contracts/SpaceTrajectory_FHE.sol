// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SpaceTrajectory_FHE is SepoliaConfig {
    struct EncryptedTrajectory {
        uint256 missionId;
        euint32 encryptedPositionX;
        euint32 encryptedPositionY;
        euint32 encryptedPositionZ;
        euint32 encryptedVelocity;
        euint32 encryptedTimeWindow;
        uint256 timestamp;
        address missionOperator;
    }

    struct DecryptedTrajectory {
        uint32 positionX;
        uint32 positionY;
        uint32 positionZ;
        uint32 velocity;
        uint32 timeWindow;
        bool isRevealed;
    }

    struct CollisionAnalysis {
        euint32 encryptedRiskScore;
        euint32 encryptedDistance;
        euint32 encryptedTimeConflict;
    }

    uint256 public missionCount;
    mapping(uint256 => EncryptedTrajectory) public encryptedTrajectories;
    mapping(uint256 => DecryptedTrajectory) public decryptedTrajectories;
    mapping(uint256 => CollisionAnalysis[]) public collisionAnalyses;

    mapping(uint256 => uint256) private requestToMissionId;
    
    event TrajectorySubmitted(uint256 indexed missionId, address indexed operator, uint256 timestamp);
    event AnalysisCompleted(uint256 indexed missionId, uint256 analysisId);
    event TrajectoryDecrypted(uint256 indexed missionId);

    function registerMission(address operator) public returns (uint256) {
        missionCount += 1;
        return missionCount;
    }

    function submitEncryptedTrajectory(
        euint32 encryptedPositionX,
        euint32 encryptedPositionY,
        euint32 encryptedPositionZ,
        euint32 encryptedVelocity,
        euint32 encryptedTimeWindow,
        address operator
    ) public {
        uint256 missionId = registerMission(operator);
        
        encryptedTrajectories[missionId] = EncryptedTrajectory({
            missionId: missionId,
            encryptedPositionX: encryptedPositionX,
            encryptedPositionY: encryptedPositionY,
            encryptedPositionZ: encryptedPositionZ,
            encryptedVelocity: encryptedVelocity,
            encryptedTimeWindow: encryptedTimeWindow,
            timestamp: block.timestamp,
            missionOperator: operator
        });

        decryptedTrajectories[missionId] = DecryptedTrajectory({
            positionX: 0,
            positionY: 0,
            positionZ: 0,
            velocity: 0,
            timeWindow: 0,
            isRevealed: false
        });

        analyzeCollisionRisks(missionId);
        emit TrajectorySubmitted(missionId, operator, block.timestamp);
    }

    function analyzeCollisionRisks(uint256 missionId) private {
        EncryptedTrajectory storage current = encryptedTrajectories[missionId];
        
        for (uint256 otherId = 1; otherId <= missionCount; otherId++) {
            if (otherId == missionId) continue;
            
            EncryptedTrajectory storage other = encryptedTrajectories[otherId];
            
            euint32 distance = calculateDistance(
                current.encryptedPositionX,
                current.encryptedPositionY,
                current.encryptedPositionZ,
                other.encryptedPositionX,
                other.encryptedPositionY,
                other.encryptedPositionZ
            );
            
            euint32 timeConflict = calculateTimeConflict(
                current.encryptedTimeWindow,
                other.encryptedTimeWindow
            );
            
            collisionAnalyses[missionId].push(CollisionAnalysis({
                encryptedRiskScore: FHE.add(
                    FHE.div(distance, FHE.asEuint32(1000)),
                    timeConflict
                ),
                encryptedDistance: distance,
                encryptedTimeConflict: timeConflict
            }));
        }

        emit AnalysisCompleted(missionId, collisionAnalyses[missionId].length - 1);
    }

    function calculateDistance(
        euint32 x1, euint32 y1, euint32 z1,
        euint32 x2, euint32 y2, euint32 z2
    ) private pure returns (euint32) {
        euint32 dx = FHE.sub(x1, x2);
        euint32 dy = FHE.sub(y1, y2);
        euint32 dz = FHE.sub(z1, z2);
        
        return FHE.add(
            FHE.add(FHE.mul(dx, dx), FHE.mul(dy, dy)),
            FHE.mul(dz, dz)
        );
    }

    function calculateTimeConflict(euint32 window1, euint32 window2) private pure returns (euint32) {
        return FHE.select(
            FHE.gt(FHE.add(window1, window2), FHE.asEuint32(100)),
            FHE.asEuint32(1),
            FHE.asEuint32(0)
        );
    }

    function requestTrajectoryDecryption(uint256 missionId) public {
        require(msg.sender == encryptedTrajectories[missionId].missionOperator, "Not mission operator");
        require(!decryptedTrajectories[missionId].isRevealed, "Already decrypted");

        EncryptedTrajectory storage trajectory = encryptedTrajectories[missionId];
        
        bytes32[] memory ciphertexts = new bytes32[](5);
        ciphertexts[0] = FHE.toBytes32(trajectory.encryptedPositionX);
        ciphertexts[1] = FHE.toBytes32(trajectory.encryptedPositionY);
        ciphertexts[2] = FHE.toBytes32(trajectory.encryptedPositionZ);
        ciphertexts[3] = FHE.toBytes32(trajectory.encryptedVelocity);
        ciphertexts[4] = FHE.toBytes32(trajectory.encryptedTimeWindow);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptTrajectory.selector);
        requestToMissionId[reqId] = missionId;
    }

    function decryptTrajectory(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 missionId = requestToMissionId[requestId];
        require(missionId != 0, "Invalid request");

        DecryptedTrajectory storage dTrajectory = decryptedTrajectories[missionId];
        require(!dTrajectory.isRevealed, "Already decrypted");

        FHE.checkSignatures(requestId, cleartexts, proof);

        (uint32 posX, uint32 posY, uint32 posZ, uint32 velocity, uint32 window) = 
            abi.decode(cleartexts, (uint32, uint32, uint32, uint32, uint32));
        
        dTrajectory.positionX = posX;
        dTrajectory.positionY = posY;
        dTrajectory.positionZ = posZ;
        dTrajectory.velocity = velocity;
        dTrajectory.timeWindow = window;
        dTrajectory.isRevealed = true;

        emit TrajectoryDecrypted(missionId);
    }

    function requestAnalysisDecryption(uint256 missionId, uint256 analysisId) public {
        require(msg.sender == encryptedTrajectories[missionId].missionOperator, "Not mission operator");
        CollisionAnalysis storage analysis = collisionAnalyses[missionId][analysisId];
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(analysis.encryptedRiskScore);
        ciphertexts[1] = FHE.toBytes32(analysis.encryptedDistance);
        ciphertexts[2] = FHE.toBytes32(analysis.encryptedTimeConflict);
        
        FHE.requestDecryption(ciphertexts, this.decryptAnalysis.selector);
    }

    function decryptAnalysis(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        FHE.checkSignatures(requestId, cleartexts, proof);
        (uint32 riskScore, uint32 distance, uint32 timeConflict) = 
            abi.decode(cleartexts, (uint32, uint32, uint32));
        // Process decrypted analysis as needed
    }

    function getDecryptedTrajectory(uint256 missionId) public view returns (
        uint32 positionX,
        uint32 positionY,
        uint32 positionZ,
        uint32 velocity,
        uint32 timeWindow,
        bool isRevealed
    ) {
        require(msg.sender == encryptedTrajectories[missionId].missionOperator, "Not mission operator");
        DecryptedTrajectory storage t = decryptedTrajectories[missionId];
        return (t.positionX, t.positionY, t.positionZ, t.velocity, t.timeWindow, t.isRevealed);
    }
}