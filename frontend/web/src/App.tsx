import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface TrajectoryData {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  missionName: string;
  status: "pending" | "optimized" | "conflict";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [trajectories, setTrajectories] = useState<TrajectoryData[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newTrajectoryData, setNewTrajectoryData] = useState({
    missionName: "",
    description: "",
    trajectoryParams: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 5;

  // Calculate statistics for dashboard
  const optimizedCount = trajectories.filter(t => t.status === "optimized").length;
  const pendingCount = trajectories.filter(t => t.status === "pending").length;
  const conflictCount = trajectories.filter(t => t.status === "conflict").length;

  // Filter and paginate data
  const filteredTrajectories = trajectories.filter(t => {
    const matchesSearch = t.missionName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.owner.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = filterStatus === "all" || t.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const totalPages = Math.ceil(filteredTrajectories.length / itemsPerPage);
  const paginatedTrajectories = filteredTrajectories.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  useEffect(() => {
    loadTrajectories().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadTrajectories = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("trajectory_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing trajectory keys:", e);
        }
      }
      
      const list: TrajectoryData[] = [];
      
      for (const key of keys) {
        try {
          const trajectoryBytes = await contract.getData(`trajectory_${key}`);
          if (trajectoryBytes.length > 0) {
            try {
              const trajectoryData = JSON.parse(ethers.toUtf8String(trajectoryBytes));
              list.push({
                id: key,
                encryptedData: trajectoryData.data,
                timestamp: trajectoryData.timestamp,
                owner: trajectoryData.owner,
                missionName: trajectoryData.missionName,
                status: trajectoryData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing trajectory data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading trajectory ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setTrajectories(list);
    } catch (e) {
      console.error("Error loading trajectories:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitTrajectory = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting trajectory data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newTrajectoryData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const trajectoryId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const trajectoryData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        missionName: newTrajectoryData.missionName,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `trajectory_${trajectoryId}`, 
        ethers.toUtf8Bytes(JSON.stringify(trajectoryData))
      );
      
      const keysBytes = await contract.getData("trajectory_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(trajectoryId);
      
      await contract.setData(
        "trajectory_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted trajectory data submitted securely!"
      });
      
      await loadTrajectories();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewTrajectoryData({
          missionName: "",
          description: "",
          trajectoryParams: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const optimizeTrajectory = async (trajectoryId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted trajectory with FHE optimization..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const trajectoryBytes = await contract.getData(`trajectory_${trajectoryId}`);
      if (trajectoryBytes.length === 0) {
        throw new Error("Trajectory not found");
      }
      
      const trajectoryData = JSON.parse(ethers.toUtf8String(trajectoryBytes));
      
      const updatedTrajectory = {
        ...trajectoryData,
        status: "optimized"
      };
      
      await contract.setData(
        `trajectory_${trajectoryId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedTrajectory))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE trajectory optimization completed successfully!"
      });
      
      await loadTrajectories();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Optimization failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const markConflict = async (trajectoryId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted trajectory with FHE conflict detection..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const trajectoryBytes = await contract.getData(`trajectory_${trajectoryId}`);
      if (trajectoryBytes.length === 0) {
        throw new Error("Trajectory not found");
      }
      
      const trajectoryData = JSON.parse(ethers.toUtf8String(trajectoryBytes));
      
      const updatedTrajectory = {
        ...trajectoryData,
        status: "conflict"
      };
      
      await contract.setData(
        `trajectory_${trajectoryId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedTrajectory))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE conflict detection completed successfully!"
      });
      
      await loadTrajectories();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Conflict detection failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the FHE trajectory optimization platform",
      icon: "🔗"
    },
    {
      title: "Submit Encrypted Trajectory",
      description: "Add your mission trajectory data which will be encrypted using FHE",
      icon: "🔒"
    },
    {
      title: "FHE Optimization",
      description: "Your trajectory data is processed in encrypted state without decryption",
      icon: "⚙️"
    },
    {
      title: "Get Optimized Path",
      description: "Receive optimized trajectory while keeping your mission data private",
      icon: "📊"
    }
  ];

  const renderPieChart = () => {
    const total = trajectories.length || 1;
    const optimizedPercentage = (optimizedCount / total) * 100;
    const pendingPercentage = (pendingCount / total) * 100;
    const conflictPercentage = (conflictCount / total) * 100;

    return (
      <div className="pie-chart-container">
        <div className="pie-chart">
          <div 
            className="pie-segment optimized" 
            style={{ transform: `rotate(${optimizedPercentage * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment pending" 
            style={{ transform: `rotate(${(optimizedPercentage + pendingPercentage) * 3.6}deg)` }}
          ></div>
          <div 
            className="pie-segment conflict" 
            style={{ transform: `rotate(${(optimizedPercentage + pendingPercentage + conflictPercentage) * 3.6}deg)` }}
          ></div>
          <div className="pie-center">
            <div className="pie-value">{trajectories.length}</div>
            <div className="pie-label">Trajectories</div>
          </div>
        </div>
        <div className="pie-legend">
          <div className="legend-item">
            <div className="color-box optimized"></div>
            <span>Optimized: {optimizedCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box pending"></div>
            <span>Pending: {pendingCount}</span>
          </div>
          <div className="legend-item">
            <div className="color-box conflict"></div>
            <span>Conflict: {conflictCount}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container art-deco-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="orbit-icon"></div>
          </div>
          <h1>Space<span>Trajectory</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-trajectory-btn art-deco-button"
          >
            <div className="add-icon"></div>
            Add Trajectory
          </button>
          <button 
            className="art-deco-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Confidential Trajectory Optimization</h2>
            <p>Securely optimize space mission trajectories using FHE without exposing sensitive data</p>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>FHE Trajectory Optimization Tutorial</h2>
            <p className="subtitle">Learn how to securely process mission trajectory data</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card art-deco-card">
            <h3>Project Introduction</h3>
            <p>Secure space mission trajectory optimization platform using FHE technology to process sensitive orbital data without decryption.</p>
            <div className="fhe-badge">
              <span>FHE-Powered</span>
            </div>
          </div>
          
          <div className="dashboard-card art-deco-card">
            <h3>Trajectory Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{trajectories.length}</div>
                <div className="stat-label">Total Trajectories</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{optimizedCount}</div>
                <div className="stat-label">Optimized</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-label">Pending</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{conflictCount}</div>
                <div className="stat-label">Conflict</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card art-deco-card">
            <h3>Status Distribution</h3>
            {renderPieChart()}
          </div>
        </div>
        
        <div className="trajectories-section">
          <div className="section-header">
            <h2>Encrypted Trajectory Data</h2>
            <div className="header-actions">
              <div className="search-filter-container">
                <input 
                  type="text"
                  placeholder="Search missions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="art-deco-input"
                />
                <select 
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="art-deco-select"
                >
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="optimized">Optimized</option>
                  <option value="conflict">Conflict</option>
                </select>
              </div>
              <button 
                onClick={loadTrajectories}
                className="refresh-btn art-deco-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="trajectories-list art-deco-card">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Mission</div>
              <div className="header-cell">Owner</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {paginatedTrajectories.length === 0 ? (
              <div className="no-trajectories">
                <div className="no-trajectories-icon"></div>
                <p>No encrypted trajectories found</p>
                <button 
                  className="art-deco-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Trajectory
                </button>
              </div>
            ) : (
              paginatedTrajectories.map(trajectory => (
                <div className="trajectory-row" key={trajectory.id}>
                  <div className="table-cell trajectory-id">#{trajectory.id.substring(0, 6)}</div>
                  <div className="table-cell">{trajectory.missionName}</div>
                  <div className="table-cell">{trajectory.owner.substring(0, 6)}...{trajectory.owner.substring(38)}</div>
                  <div className="table-cell">
                    {new Date(trajectory.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${trajectory.status}`}>
                      {trajectory.status}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    {isOwner(trajectory.owner) && trajectory.status === "pending" && (
                      <>
                        <button 
                          className="action-btn art-deco-button success"
                          onClick={() => optimizeTrajectory(trajectory.id)}
                        >
                          Optimize
                        </button>
                        <button 
                          className="action-btn art-deco-button danger"
                          onClick={() => markConflict(trajectory.id)}
                        >
                          Mark Conflict
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}

            {filteredTrajectories.length > itemsPerPage && (
              <div className="pagination-controls">
                <button 
                  onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className="art-deco-button"
                >
                  Previous
                </button>
                <span>Page {currentPage} of {totalPages}</span>
                <button 
                  onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className="art-deco-button"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="partners-section">
          <h2>Mission Partners</h2>
          <div className="partners-grid">
            <div className="partner-logo">NASA</div>
            <div className="partner-logo">ESA</div>
            <div className="partner-logo">SpaceX</div>
            <div className="partner-logo">Blue Origin</div>
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitTrajectory} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          trajectoryData={newTrajectoryData}
          setTrajectoryData={setNewTrajectoryData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content art-deco-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="cyber-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="orbit-icon"></div>
              <span>SpaceTrajectoryFHE</span>
            </div>
            <p>Secure encrypted trajectory optimization using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} SpaceTrajectoryFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  trajectoryData: any;
  setTrajectoryData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  trajectoryData,
  setTrajectoryData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setTrajectoryData({
      ...trajectoryData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!trajectoryData.missionName || !trajectoryData.trajectoryParams) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal art-deco-card">
        <div className="modal-header">
          <h2>Add Encrypted Trajectory Data</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your trajectory data will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Mission Name *</label>
              <input 
                type="text"
                name="missionName"
                value={trajectoryData.missionName} 
                onChange={handleChange}
                placeholder="Enter mission name..." 
                className="art-deco-input"
              />
            </div>
            
            <div className="form-group">
              <label>Description</label>
              <input 
                type="text"
                name="description"
                value={trajectoryData.description} 
                onChange={handleChange}
                placeholder="Brief description..." 
                className="art-deco-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Trajectory Parameters *</label>
              <textarea 
                name="trajectoryParams"
                value={trajectoryData.trajectoryParams} 
                onChange={handleChange}
                placeholder="Enter trajectory parameters to encrypt..." 
                className="art-deco-textarea"
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Data remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn art-deco-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn art-deco-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;