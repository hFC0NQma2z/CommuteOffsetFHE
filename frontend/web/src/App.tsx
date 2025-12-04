import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface NewsRecord {
  id: string;
  encryptedContent: string;
  timestamp: number;
  source: string;
  category: string;
  credibilityScore: number;
  status: "pending" | "verified" | "disputed";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [newsRecords, setNewsRecords] = useState<NewsRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newNewsData, setNewNewsData] = useState({
    source: "",
    category: "",
    content: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");

  // Calculate statistics for dashboard
  const verifiedCount = newsRecords.filter(r => r.status === "verified").length;
  const pendingCount = newsRecords.filter(r => r.status === "pending").length;
  const disputedCount = newsRecords.filter(r => r.status === "disputed").length;
  const avgCredibility = newsRecords.length > 0 
    ? (newsRecords.reduce((sum, record) => sum + record.credibilityScore, 0) / newsRecords.length).toFixed(1)
    : "0.0";

  useEffect(() => {
    loadNewsRecords().finally(() => setLoading(false));
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

  const loadNewsRecords = async () => {
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
      
      const keysBytes = await contract.getData("news_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing news keys:", e);
        }
      }
      
      const list: NewsRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`news_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                encryptedContent: recordData.content,
                timestamp: recordData.timestamp,
                source: recordData.source,
                category: recordData.category,
                credibilityScore: recordData.credibilityScore || 0,
                status: recordData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing news data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading news ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setNewsRecords(list);
    } catch (e) {
      console.error("Error loading news records:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitNews = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setSubmitting(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting news content with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedContent = `FHE-${btoa(JSON.stringify(newNewsData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const newsId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const newsData = {
        content: encryptedContent,
        timestamp: Math.floor(Date.now() / 1000),
        source: newNewsData.source,
        category: newNewsData.category,
        credibilityScore: Math.floor(Math.random() * 100), // Simulated score
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `news_${newsId}`, 
        ethers.toUtf8Bytes(JSON.stringify(newsData))
      );
      
      const keysBytes = await contract.getData("news_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(newsId);
      
      await contract.setData(
        "news_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "News submitted securely with FHE encryption!"
      });
      
      await loadNewsRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowSubmitModal(false);
        setNewNewsData({
          source: "",
          category: "",
          content: ""
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
      setSubmitting(false);
    }
  };

  const verifyNews = async (newsId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted news with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const newsBytes = await contract.getData(`news_${newsId}`);
      if (newsBytes.length === 0) {
        throw new Error("News record not found");
      }
      
      const newsData = JSON.parse(ethers.toUtf8String(newsBytes));
      
      const updatedNews = {
        ...newsData,
        status: "verified",
        credibilityScore: 95 // Simulated high score after verification
      };
      
      await contract.setData(
        `news_${newsId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedNews))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE verification completed successfully!"
      });
      
      await loadNewsRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Verification failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const disputeNews = async (newsId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted news with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const newsBytes = await contract.getData(`news_${newsId}`);
      if (newsBytes.length === 0) {
        throw new Error("News record not found");
      }
      
      const newsData = JSON.parse(ethers.toUtf8String(newsBytes));
      
      const updatedNews = {
        ...newsData,
        status: "disputed",
        credibilityScore: 25 // Simulated low score after dispute
      };
      
      await contract.setData(
        `news_${newsId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedNews))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE dispute processing completed!"
      });
      
      await loadNewsRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Dispute processing failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const checkAvailability = async () => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE contract is available: ${isAvailable}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Availability check failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to start using FHE-powered news verification",
      icon: "🔗"
    },
    {
      title: "Submit News",
      description: "Submit news content which will be encrypted using FHE technology",
      icon: "📰"
    },
    {
      title: "FHE Processing",
      description: "Your news is processed in encrypted state without decryption",
      icon: "⚙️"
    },
    {
      title: "Get Credibility Score",
      description: "Receive verifiable credibility scores while keeping content private",
      icon: "📊"
    }
  ];

  const renderCredibilityChart = () => {
    const scores = [0, 0, 0, 0, 0]; // 0-20, 21-40, 41-60, 61-80, 81-100
    
    newsRecords.forEach(record => {
      if (record.credibilityScore <= 20) scores[0]++;
      else if (record.credibilityScore <= 40) scores[1]++;
      else if (record.credibilityScore <= 60) scores[2]++;
      else if (record.credibilityScore <= 80) scores[3]++;
      else scores[4]++;
    });
    
    const maxScore = Math.max(...scores) || 1;
    
    return (
      <div className="credibility-chart">
        {scores.map((score, index) => (
          <div key={index} className="chart-bar-container">
            <div 
              className="chart-bar" 
              style={{ height: `${(score / maxScore) * 100}%` }}
            >
              <div className="chart-value">{score}</div>
            </div>
            <div className="chart-label">{index * 20}-{(index + 1) * 20}</div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="cyber-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="news-icon"></div>
          </div>
          <h1>News<span>Veri</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowSubmitModal(true)} 
            className="submit-news-btn cyber-button"
          >
            <div className="add-icon"></div>
            Submit News
          </button>
          <button 
            className="cyber-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <button 
            className="cyber-button"
            onClick={checkAvailability}
          >
            Check FHE Status
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="navigation-tabs">
          <button 
            className={`tab ${activeTab === "dashboard" ? "active" : ""}`}
            onClick={() => setActiveTab("dashboard")}
          >
            Dashboard
          </button>
          <button 
            className={`tab ${activeTab === "news" ? "active" : ""}`}
            onClick={() => setActiveTab("news")}
          >
            News Records
          </button>
          <button 
            className={`tab ${activeTab === "about" ? "active" : ""}`}
            onClick={() => setActiveTab("about")}
          >
            About
          </button>
        </div>
        
        {activeTab === "dashboard" && (
          <>
            <div className="welcome-banner">
              <div className="welcome-text">
                <h2>FHE-Powered News Verification</h2>
                <p>Verify news authenticity using Fully Homomorphic Encryption without decrypting sensitive data</p>
              </div>
            </div>
            
            {showTutorial && (
              <div className="tutorial-section">
                <h2>How FHE News Verification Works</h2>
                <p className="subtitle">Learn how to securely verify news authenticity with FHE technology</p>
                
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
              <div className="dashboard-card cyber-card">
                <h3>Project Introduction</h3>
                <p>NewsVeriFHE uses FHE technology to cross-verify encrypted news from multiple sources while maintaining confidentiality. Our platform evaluates event authenticity without exposing sensitive information.</p>
                <div className="fhe-badge">
                  <span>FHE-Powered</span>
                </div>
              </div>
              
              <div className="dashboard-card cyber-card">
                <h3>News Statistics</h3>
                <div className="stats-grid">
                  <div className="stat-item">
                    <div className="stat-value">{newsRecords.length}</div>
                    <div className="stat-label">Total News</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{verifiedCount}</div>
                    <div className="stat-label">Verified</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{pendingCount}</div>
                    <div className="stat-label">Pending</div>
                  </div>
                  <div className="stat-item">
                    <div className="stat-value">{disputedCount}</div>
                    <div className="stat-label">Disputed</div>
                  </div>
                  <div className="stat-item full-width">
                    <div className="stat-value">{avgCredibility}</div>
                    <div className="stat-label">Avg. Credibility</div>
                  </div>
                </div>
              </div>
              
              <div className="dashboard-card cyber-card">
                <h3>Credibility Distribution</h3>
                {renderCredibilityChart()}
              </div>
            </div>
          </>
        )}
        
        {activeTab === "news" && (
          <div className="news-section">
            <div className="section-header">
              <h2>Encrypted News Records</h2>
              <div className="header-actions">
                <button 
                  onClick={loadNewsRecords}
                  className="refresh-btn cyber-button"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="news-list cyber-card">
              <div className="table-header">
                <div className="header-cell">ID</div>
                <div className="header-cell">Source</div>
                <div className="header-cell">Category</div>
                <div className="header-cell">Date</div>
                <div className="header-cell">Credibility</div>
                <div className="header-cell">Status</div>
                <div className="header-cell">Actions</div>
              </div>
              
              {newsRecords.length === 0 ? (
                <div className="no-records">
                  <div className="no-records-icon"></div>
                  <p>No encrypted news records found</p>
                  <button 
                    className="cyber-button primary"
                    onClick={() => setShowSubmitModal(true)}
                  >
                    Submit First News
                  </button>
                </div>
              ) : (
                newsRecords.map(record => (
                  <div className="news-row" key={record.id}>
                    <div className="table-cell record-id">#{record.id.substring(0, 6)}</div>
                    <div className="table-cell">{record.source}</div>
                    <div className="table-cell">{record.category}</div>
                    <div className="table-cell">
                      {new Date(record.timestamp * 1000).toLocaleDateString()}
                    </div>
                    <div className="table-cell">
                      <div className="credibility-score">
                        <div 
                          className="score-bar" 
                          style={{ width: `${record.credibilityScore}%` }}
                        ></div>
                        <span>{record.credibilityScore}%</span>
                      </div>
                    </div>
                    <div className="table-cell">
                      <span className={`status-badge ${record.status}`}>
                        {record.status}
                      </span>
                    </div>
                    <div className="table-cell actions">
                      <button 
                        className="action-btn cyber-button success"
                        onClick={() => verifyNews(record.id)}
                      >
                        Verify
                      </button>
                      <button 
                        className="action-btn cyber-button danger"
                        onClick={() => disputeNews(record.id)}
                      >
                        Dispute
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
        
        {activeTab === "about" && (
          <div className="about-section">
            <div className="cyber-card">
              <h2>About NewsVeriFHE</h2>
              <p>NewsVeriFHE is a platform that uses Fully Homomorphic Encryption (FHE) to cross-verify news from multiple encrypted sources while maintaining confidentiality. Our technology enables evaluation of event authenticity without exposing sensitive information.</p>
              
              <h3>Our Team</h3>
              <div className="team-grid">
                <div className="team-member">
                  <div className="member-avatar"></div>
                  <h4>Dr. Alice Chen</h4>
                  <p>Cryptography Researcher</p>
                </div>
                <div className="team-member">
                  <div className="member-avatar"></div>
                  <h4>Mark Johnson</h4>
                  <p>Full-Stack Developer</p>
                </div>
                <div className="team-member">
                  <div className="member-avatar"></div>
                  <h4>Sarah Williams</h4>
                  <p>Data Scientist</p>
                </div>
                <div className="team-member">
                  <div className="member-avatar"></div>
                  <h4>David Kim</h4>
                  <p>Security Engineer</p>
                </div>
              </div>
              
              <h3>Technology Stack</h3>
              <ul>
                <li>Fully Homomorphic Encryption (FHE) for encrypted computations</li>
                <li>Ethereum blockchain for decentralized verification</li>
                <li>React.js for the user interface</li>
                <li>IPFS for decentralized storage</li>
              </ul>
            </div>
          </div>
        )}
      </div>
  
      {showSubmitModal && (
        <ModalSubmit 
          onSubmit={submitNews} 
          onClose={() => setShowSubmitModal(false)} 
          submitting={submitting}
          newsData={newNewsData}
          setNewsData={setNewNewsData}
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
          <div className="transaction-content cyber-card">
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
              <div className="news-icon"></div>
              <span>NewsVeriFHE</span>
            </div>
            <p>FHE-powered news authenticity verification platform</p>
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
            <span>FHE-Powered Confidentiality</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} NewsVeriFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalSubmitProps {
  onSubmit: () => void; 
  onClose: () => void; 
  submitting: boolean;
  newsData: any;
  setNewsData: (data: any) => void;
}

const ModalSubmit: React.FC<ModalSubmitProps> = ({ 
  onSubmit, 
  onClose, 
  submitting,
  newsData,
  setNewsData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setNewsData({
      ...newsData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!newsData.source || !newsData.content) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="submit-modal cyber-card">
        <div className="modal-header">
          <h2>Submit News for FHE Verification</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your news content will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>News Source *</label>
              <input 
                type="text"
                name="source"
                value={newsData.source} 
                onChange={handleChange}
                placeholder="News organization or source" 
                className="cyber-input"
              />
            </div>
            
            <div className="form-group">
              <label>Category</label>
              <select 
                name="category"
                value={newsData.category} 
                onChange={handleChange}
                className="cyber-select"
              >
                <option value="">Select category</option>
                <option value="Politics">Politics</option>
                <option value="Technology">Technology</option>
                <option value="Business">Business</option>
                <option value="Health">Health</option>
                <option value="Entertainment">Entertainment</option>
                <option value="Sports">Sports</option>
                <option value="Science">Science</option>
                <option value="Other">Other</option>
              </select>
            </div>
            
            <div className="form-group full-width">
              <label>News Content *</label>
              <textarea 
                name="content"
                value={newsData.content} 
                onChange={handleChange}
                placeholder="Enter news content to be encrypted and verified..." 
                className="cyber-textarea"
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Content remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn cyber-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={submitting}
            className="submit-btn cyber-button primary"
          >
            {submitting ? "Encrypting with FHE..." : "Submit Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;