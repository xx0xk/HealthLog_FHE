import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface HealthEntry {
  id: string;
  symptom: string;
  severity: number;
  notes: string;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface HealthStats {
  totalEntries: number;
  avgSeverity: number;
  symptomFrequency: { [key: string]: number };
  recentActivity: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<HealthEntry[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingEntry, setCreatingEntry] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newEntryData, setNewEntryData] = useState({ symptom: "", severity: 5, notes: "" });
  const [selectedEntry, setSelectedEntry] = useState<HealthEntry | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const entriesPerPage = 5;
  const [userHistory, setUserHistory] = useState<string[]>([]);
  const [stats, setStats] = useState<HealthStats>({ totalEntries: 0, avgSeverity: 0, symptomFrequency: {}, recentActivity: 0 });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized) return;
      try {
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadData = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        const contract = await getContractReadOnly();
        if (!contract) return;
        
        const businessIds = await contract.getAllBusinessIds();
        const entriesList: HealthEntry[] = [];
        
        for (const businessId of businessIds) {
          try {
            const businessData = await contract.getBusinessData(businessId);
            entriesList.push({
              id: businessId,
              symptom: businessData.name,
              severity: Number(businessData.publicValue1) || 0,
              notes: businessData.description,
              timestamp: Number(businessData.timestamp),
              creator: businessData.creator,
              isVerified: businessData.isVerified,
              decryptedValue: Number(businessData.decryptedValue) || 0
            });
          } catch (e) {
            console.error('Error loading health data:', e);
          }
        }
        
        setEntries(entriesList);
        calculateStats(entriesList);
      } catch (e) {
        setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally { 
        setLoading(false); 
      }
    };

    loadData();
  }, [isConnected]);

  const calculateStats = (entriesList: HealthEntry[]) => {
    const totalEntries = entriesList.length;
    const avgSeverity = totalEntries > 0 ? entriesList.reduce((sum, e) => sum + e.severity, 0) / totalEntries : 0;
    
    const symptomFrequency: { [key: string]: number } = {};
    entriesList.forEach(entry => {
      symptomFrequency[entry.symptom] = (symptomFrequency[entry.symptom] || 0) + 1;
    });

    const oneWeekAgo = Date.now() / 1000 - 604800;
    const recentActivity = entriesList.filter(e => e.timestamp > oneWeekAgo).length;

    setStats({ totalEntries, avgSeverity, symptomFrequency, recentActivity });
  };

  const createEntry = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingEntry(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating health entry with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const businessId = `health-${Date.now()}`;
      const contractAddress = await contract.getAddress();
      
      const encryptedResult = await encrypt(contractAddress, address, newEntryData.severity);
      
      const tx = await contract.createBusinessData(
        businessId,
        newEntryData.symptom,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        newEntryData.severity,
        0,
        newEntryData.notes
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setUserHistory(prev => [...prev, `Created entry: ${newEntryData.symptom}`]);
      setTransactionStatus({ visible: true, status: "success", message: "Health entry created successfully!" });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewEntryData({ symptom: "", severity: 5, notes: "" });
      }, 2000);
      
      const updatedEntries = [...entries, {
        id: businessId,
        symptom: newEntryData.symptom,
        severity: newEntryData.severity,
        notes: newEntryData.notes,
        timestamp: Date.now() / 1000,
        creator: address
      }];
      setEntries(updatedEntries);
      calculateStats(updatedEntries);
      
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingEntry(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      const contractAddress = await contractWrite.getAddress();
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      setUserHistory(prev => [...prev, `Decrypted entry: ${businessId}`]);
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted successfully!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const callIsAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const result = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredEntries = entries.filter(entry => 
    entry.symptom.toLowerCase().includes(searchTerm.toLowerCase()) ||
    entry.notes.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const paginatedEntries = filteredEntries.slice(
    (currentPage - 1) * entriesPerPage,
    currentPage * entriesPerPage
  );

  const totalPages = Math.ceil(filteredEntries.length / entriesPerPage);

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>🔐 Confidential Health Diary</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🏥</div>
            <h2>Connect Your Wallet to Start</h2>
            <p>Secure your health data with FHE encryption. Connect your wallet to begin tracking symptoms privately.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading health diary...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>🔐 Confidential Health Diary</h1>
          <p>FHE-encrypted symptom tracking</p>
        </div>
        
        <div className="header-actions">
          <button onClick={callIsAvailable} className="test-btn">Test Contract</button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">+ New Entry</button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-panel">
          <div className="stat-card">
            <h3>Total Entries</h3>
            <div className="stat-value">{stats.totalEntries}</div>
          </div>
          <div className="stat-card">
            <h3>Avg Severity</h3>
            <div className="stat-value">{stats.avgSeverity.toFixed(1)}/10</div>
          </div>
          <div className="stat-card">
            <h3>This Week</h3>
            <div className="stat-value">{stats.recentActivity}</div>
          </div>
        </div>

        <div className="search-section">
          <input
            type="text"
            placeholder="Search symptoms or notes..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
        </div>

        <div className="entries-section">
          <h2>Health Entries</h2>
          <div className="entries-list">
            {paginatedEntries.map((entry, index) => (
              <div 
                key={index} 
                className="entry-card"
                onClick={() => setSelectedEntry(entry)}
              >
                <div className="entry-header">
                  <h3>{entry.symptom}</h3>
                  <span className={`severity severity-${Math.floor(entry.severity/3)}`}>
                    Severity: {entry.severity}/10
                  </span>
                </div>
                <p className="entry-notes">{entry.notes}</p>
                <div className="entry-footer">
                  <span>{new Date(entry.timestamp * 1000).toLocaleDateString()}</span>
                  {entry.isVerified && <span className="verified-badge">✓ Verified</span>}
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="pagination">
              <button 
                disabled={currentPage === 1} 
                onClick={() => setCurrentPage(currentPage - 1)}
              >
                Previous
              </button>
              <span>Page {currentPage} of {totalPages}</span>
              <button 
                disabled={currentPage === totalPages} 
                onClick={() => setCurrentPage(currentPage + 1)}
              >
                Next
              </button>
            </div>
          )}
        </div>

        <div className="history-panel">
          <h3>Recent Activity</h3>
          <div className="history-list">
            {userHistory.slice(-5).map((action, index) => (
              <div key={index} className="history-item">{action}</div>
            ))}
          </div>
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>New Health Entry</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Symptom</label>
                <input 
                  type="text" 
                  value={newEntryData.symptom}
                  onChange={(e) => setNewEntryData({...newEntryData, symptom: e.target.value})}
                  placeholder="e.g., Headache, Fever"
                />
              </div>
              <div className="form-group">
                <label>Severity (1-10)</label>
                <input 
                  type="range" 
                  min="1" 
                  max="10" 
                  value={newEntryData.severity}
                  onChange={(e) => setNewEntryData({...newEntryData, severity: parseInt(e.target.value)})}
                />
                <span className="severity-value">{newEntryData.severity}</span>
              </div>
              <div className="form-group">
                <label>Notes</label>
                <textarea 
                  value={newEntryData.notes}
                  onChange={(e) => setNewEntryData({...newEntryData, notes: e.target.value})}
                  placeholder="Additional details..."
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)}>Cancel</button>
              <button 
                onClick={createEntry} 
                disabled={creatingEntry || isEncrypting || !newEntryData.symptom}
                className="primary"
              >
                {creatingEntry ? "Encrypting..." : "Create Entry"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedEntry && (
        <EntryDetailModal 
          entry={selectedEntry} 
          onClose={() => setSelectedEntry(null)} 
          onDecrypt={decryptData}
        />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          {transactionStatus.message}
        </div>
      )}
    </div>
  );
};

const EntryDetailModal: React.FC<{
  entry: HealthEntry;
  onClose: () => void;
  onDecrypt: (id: string) => Promise<number | null>;
}> = ({ entry, onClose, onDecrypt }) => {
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);

  const handleDecrypt = async () => {
    setIsDecrypting(true);
    const value = await onDecrypt(entry.id);
    setDecryptedValue(value);
    setIsDecrypting(false);
  };

  return (
    <div className="modal-overlay">
      <div className="detail-modal">
        <div className="modal-header">
          <h2>Entry Details</h2>
          <button onClick={onClose} className="close-btn">×</button>
        </div>
        <div className="modal-body">
          <div className="detail-section">
            <h3>Symptom</h3>
            <p>{entry.symptom}</p>
          </div>
          <div className="detail-section">
            <h3>Severity</h3>
            <div className="severity-display">
              <span>Public: {entry.severity}/10</span>
              {entry.isVerified || decryptedValue !== null ? (
                <span className="encrypted-value">
                  Encrypted: {entry.isVerified ? entry.decryptedValue : decryptedValue}/10
                </span>
              ) : (
                <span className="encrypted-value">🔒 FHE Encrypted</span>
              )}
            </div>
          </div>
          <div className="detail-section">
            <h3>Notes</h3>
            <p>{entry.notes}</p>
          </div>
          <div className="detail-section">
            <h3>FHE Status</h3>
            <div className="fhe-status">
              {entry.isVerified ? (
                <span className="status-verified">✓ On-chain Verified</span>
              ) : decryptedValue !== null ? (
                <span className="status-decrypted">🔓 Locally Decrypted</span>
              ) : (
                <span className="status-encrypted">🔐 Encrypted</span>
              )}
            </div>
            <button 
              onClick={handleDecrypt} 
              disabled={isDecrypting || entry.isVerified}
              className="decrypt-btn"
            >
              {isDecrypting ? "Decrypting..." : entry.isVerified ? "Verified" : "Decrypt Data"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;


